#!/bin/sh
# Tests for the flock-based deploy lock in deploy/lib.sh: races between real processes, a holder
# that is killed, hand-off rules, and the same lock taken from separate containers (no shared PID
# namespace) and from the host, through a bind-mounted state/ directory.
# Usage: sh deploy/tests/test-lock.sh   (needs flock; the container cases need docker, else skipped)
# Env: KC_TEST_TMP (parent for the temp dir; must be visible to the docker daemon),
#      KC_TEST_IMAGE (default debian:bookworm-slim, needs util-linux), KC_SKIP_DOCKER_TESTS=1.
set -u
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
cd "$ROOT" || exit 1
command -v flock >/dev/null 2>&1 || { echo "flock (util-linux) is required for this test"; exit 1; }

if [ -n "${KC_TEST_TMP:-}" ]; then
	mkdir -p "$KC_TEST_TMP"
	T=$(mktemp -d "$KC_TEST_TMP/lock.XXXXXX")
else
	T=$(mktemp -d)
fi
trap 'rm -rf "$T"' EXIT
fails=0
pass() { printf 'ok   %s\n' "$1"; }
fail() { printf 'FAIL %s\n' "$1"; fails=$((fails + 1)); }

fresh() { rm -rf "$T/state" "$T"/*.rc "$T"/*.err; mkdir -p "$T/state"; }
count() { if [ -f "$1" ]; then wc -l <"$1" | tr -d ' '; else echo 0; fi; }
wait_for() { # wait_for FILE: until it has content (max ~20 s)
	_i=0
	while [ ! -s "$1" ] && [ "$_i" -lt 200 ]; do sleep 0.1; _i=$((_i + 1)); done
}

# contender NAME HOLD: take the lock in a fresh process (its own pid), hold it, exit. Appends NAME
# to winners on success; the exit status goes to $T/NAME.rc (75 = refused as busy).
contender() {
	(
		sh -c '
			KC_STATE_DIR=$1; export KC_STATE_DIR
			. "$2/deploy/lib.sh"
			with_lock
			echo "$3" >>"$1/winners"
			sleep "$4"
		' sh "$T/state" "$ROOT" "$1" "$2" >/dev/null 2>"$T/$1.err"
		echo $? >"$T/$1.rc"
	) &
}

rc_busy() { cat "$T"/c*.rc 2>/dev/null | grep -c '^75$'; }

round() { # round NAME N: N contenders at once; exactly one may win
	fresh
	_i=1
	while [ "$_i" -le "$2" ]; do contender "c$_i" 3; _i=$((_i + 1)); done
	wait
	_w=$(count "$T/state/winners")
	_b=$(rc_busy)
	if [ "$_w" = 1 ] && [ "$_b" = "$(($2 - 1))" ]; then pass "$1: one winner, $_b refused (exit 75)"; else fail "$1: winners=$_w busy=$_b (expected 1 and $(($2 - 1)))"; fi
}

for n in 1 2 3 4 5; do round "race $n" 8; done

# A holder that is killed frees the lock at once (no stale-lock handling).
fresh
sh -c 'KC_STATE_DIR=$1; export KC_STATE_DIR; . "$2/deploy/lib.sh"; with_lock; echo holder >>"$1/winners"; exec sleep 60' sh "$T/state" "$ROOT" &
holder=$!
wait_for "$T/state/winners"
sh -c 'KC_STATE_DIR=$1; export KC_STATE_DIR; . "$2/deploy/lib.sh"; with_lock; exit 0' sh "$T/state" "$ROOT" >/dev/null 2>&1
if [ $? = 75 ]; then pass "lock held by a live process refuses others"; else fail "live holder did not refuse"; fi
kill -KILL "$holder"
wait "$holder" 2>/dev/null
if sh -c 'KC_STATE_DIR=$1; export KC_STATE_DIR; . "$2/deploy/lib.sh"; with_lock; exit 0' sh "$T/state" "$ROOT" >/dev/null 2>&1; then pass "holder killed (SIGKILL): lock free immediately"; else fail "lock not free after the holder was killed"; fi

# A refused run must not touch the holder's state (here: the *.prev nginx snapshot).
fresh
rm -rf "$T/box"
mkdir -p "$T/box/deploy/nginx"
echo old >"$T/box/deploy/nginx/x.conf.prev"
echo new >"$T/box/deploy/nginx/x.conf"
contender holder 3
wait_for "$T/state/winners"
(cd "$T/box" && sh -c 'KC_STATE_DIR=$1; export KC_STATE_DIR; . "$2/deploy/lib.sh"; with_lock; exit 0' sh "$T/state" "$ROOT" >/dev/null 2>&1)
rc=$?
wait
if [ "$rc" = 75 ] && [ -f "$T/box/deploy/nginx/x.conf.prev" ] && [ "$(cat "$T/box/deploy/nginx/x.conf")" = new ]; then
	pass "a refused run leaves the holder's nginx snapshot alone"
else
	fail "a refused run touched state (rc=$rc)"
fi

# Hand-off: the holder's re-exec (same pid) and its direct child are accepted; strangers and a
# forged marker (nobody holds the lock) are not.
fresh
sh -c '
	KC_STATE_DIR=$1; export KC_STATE_DIR
	. "$2/deploy/lib.sh"
	with_lock
	child=". $2/deploy/lib.sh; with_lock; exit 0"
	env -u KC_LOCK_HOLDER sh -c "$child" 2>/dev/null
	[ $? = 75 ] || exit 11
	sh -c "$child" || exit 12
	exec sh -c ". $2/deploy/lib.sh; with_lock; [ -n \"\$HAVE_LOCK\" ] || exit 13; exit 0"
' sh "$T/state" "$ROOT"
rc=$?
if [ $rc = 0 ]; then pass "hand-off: stranger refused (75), child and same-pid re-exec accepted"; else fail "hand-off (rc=$rc)"; fi
fresh
KC_STATE_DIR="$T/state" KC_LOCK_HOLDER=$$ sh -c '. "$1/deploy/lib.sh"; with_lock; exit 0' sh "$ROOT" >/dev/null 2>&1
if [ $? = 1 ]; then pass "forged KC_LOCK_HOLDER without a held lock is rejected"; else fail "forged marker accepted"; fi

# Containers: separate PID namespaces (each sees its own pid 1) sharing only the state/ bind mount.
IMAGE=${KC_TEST_IMAGE:-debian:bookworm-slim}
if [ "${KC_SKIP_DOCKER_TESTS:-0}" = 1 ] || ! command -v docker >/dev/null 2>&1 || ! docker info >/dev/null 2>&1; then
	echo "skip container cases (no docker)"
elif ! docker image inspect "$IMAGE" >/dev/null 2>&1 && ! docker pull -q "$IMAGE" >/dev/null 2>&1; then
	echo "skip container cases (cannot get $IMAGE)"
else
	mkdir -p "$T/app/deploy"
	cp "$ROOT/deploy/lib.sh" "$T/app/deploy/lib.sh"
	# ctr NAME HOLD: like contender, but in a throwaway container.
	ctr() {
		(
			docker run --rm --user "$(id -u):$(id -g)" -v "$T/app:/app:ro" -v "$T/state:/state" -e KC_STATE_DIR=/state \
				"$IMAGE" sh -c '. /app/deploy/lib.sh; with_lock; echo "$0" >>/state/winners; sleep "$1"' "$1" "$2" >/dev/null 2>"$T/$1.err"
			echo $? >"$T/$1.rc"
		) &
	}
	fresh
	for n in 1 2 3 4; do ctr "c$n" 8; done
	wait
	_w=$(count "$T/state/winners")
	_b=$(rc_busy)
	if [ "$_w" = 1 ] && [ "$_b" = 3 ]; then pass "4 containers race: one winner, 3 refused (exit 75)"; else fail "containers: winners=$_w busy=$_b"; fi

	fresh
	ctr c1 8
	wait_for "$T/state/winners"
	sh -c 'KC_STATE_DIR=$1; export KC_STATE_DIR; . "$2/deploy/lib.sh"; with_lock; exit 0' sh "$T/state" "$ROOT" >/dev/null 2>&1
	if [ $? = 75 ]; then pass "container holds, host contender refused"; else fail "host was not refused by a container holder"; fi
	wait

	fresh
	contender c1 8
	wait_for "$T/state/winners"
	ctr c2 1
	wait
	if [ "$(cat "$T/c2.rc")" = 75 ] && [ "$(count "$T/state/winners")" = 1 ]; then pass "host holds, container contender refused"; else fail "container was not refused by a host holder"; fi
fi

# Tags.
. "$ROOT/deploy/lib.sh"
for t in abc123 0123456789ab v1.2-rc_3; do
	if valid_tag "$t"; then pass "tag $t valid"; else fail "tag $t should be valid"; fi
done
for t in '' blue green next latest 'a b' 'a/b' "$(printf 'a\nb')"; do
	if valid_tag "$t"; then fail "tag '$t' should be rejected"; else pass "tag rejected"; fi
done

if [ "$fails" = 0 ]; then echo "all lock tests passed"; else echo "$fails failure(s)"; exit 1; fi
