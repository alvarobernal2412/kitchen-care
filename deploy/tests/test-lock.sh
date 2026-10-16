#!/bin/sh
# Tests for the deploy lock in deploy/lib.sh (no docker needed): a race between contenders, stale
# lock recovery, never a pid-less lock, re-entrancy. Usage: sh deploy/tests/test-lock.sh
set -u
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
cd "$ROOT" || exit 1

T=$(mktemp -d)
trap 'rm -rf "$T"' EXIT
fails=0
pass() { printf 'ok   %s\n' "$1"; }
fail() { printf 'FAIL %s\n' "$1"; fails=$((fails + 1)); }

# contender NAME HOLD-SECONDS: take the lock in a fresh process (its own pid), hold it, exit.
# Writes "<name> won" on success; the exit status goes to $T/<name>.rc (75 = refused as busy).
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

# watch_pidless: poll while contenders run; a lock file that exists must always carry a pid.
watch_pidless() {
	_end=$(($(date +%s) + $1))
	while [ "$(date +%s)" -lt "$_end" ]; do
		if [ -e "$T/state/.lock" ] && [ -z "$(sed -n '1p' "$T/state/.lock" 2>/dev/null)" ] && [ -e "$T/state/.lock" ]; then # exists but empty
			echo pidless >>"$T/pidless"
		fi
	done
}

count() { [ -f "$1" ] && wc -l <"$1" | tr -d ' ' || echo 0; }

round() { # round NAME N: N contenders at once; exactly one may win
	rm -rf "$T/state" "$T"/*.rc "$T"/*.err "$T/pidless"
	mkdir -p "$T/state"
	[ -z "${PRELOCK:-}" ] || cp "$PRELOCK" "$T/state/.lock"
	_i=1
	while [ "$_i" -le "$2" ]; do contender "c$_i" 3; _i=$((_i + 1)); done
	watch_pidless 2 &
	wait
	_w=$(count "$T/state/winners")
	_busy=$(cat "$T"/c*.rc 2>/dev/null | grep -c '^75$')
	if [ "$_w" = 1 ] && [ "$_busy" = "$(($2 - 1))" ]; then pass "$1: one winner, $((_busy)) refused (exit 75)"; else fail "$1: winners=$_w busy=$_busy (expected 1 and $(($2 - 1)))"; fi
	if [ -f "$T/pidless" ]; then fail "$1: observed a lock without a pid"; fi
	if [ -e "$T/state/.lock" ]; then fail "$1: lock left behind"; fi
}

for n in 1 2 3 4 5; do round "race $n" 6; done

# Stale lock (dead pid) recovered by exactly one of several contenders.
sh -c 'echo $$' >"$T/deadpid"
printf '%s\n2000-01-01T00:00:00Z\n' "$(cat "$T/deadpid")" >"$T/stale.lock"
for n in 1 2 3; do PRELOCK="$T/stale.lock" round "stale lock $n" 6; done

# A refused run must not touch the holder's state (here: the *.prev nginx snapshot).
rm -rf "$T/state" "$T/box"
mkdir -p "$T/state" "$T/box/deploy/nginx"
echo old >"$T/box/deploy/nginx/x.conf.prev"
echo new >"$T/box/deploy/nginx/x.conf"
contender holder 3
sleep 1
(cd "$T/box" && sh -c 'KC_STATE_DIR=$1; export KC_STATE_DIR; . "$2/deploy/lib.sh"; with_lock; exit 0' sh "$T/state" "$ROOT" >/dev/null 2>&1)
rc=$?
wait
if [ "$rc" = 75 ] && [ -f "$T/box/deploy/nginx/x.conf.prev" ] && [ "$(cat "$T/box/deploy/nginx/x.conf")" = new ]; then
	pass "a refused run leaves the holder's nginx snapshot alone"
else
	fail "a refused run touched state (rc=$rc)"
fi

# Re-entrancy: a stranger is refused while the holder lives; a direct child told KC_LOCK_PARENT
# proceeds without owning the lock and must not remove it.
rm -rf "$T/state"
mkdir -p "$T/state"
sh -c '
	KC_STATE_DIR=$1; export KC_STATE_DIR
	. "$2/deploy/lib.sh"
	with_lock
	child="KC_STATE_DIR=$1; export KC_STATE_DIR; . $2/deploy/lib.sh; with_lock; exit 0"
	sh -c "$child" 2>/dev/null
	[ $? = 75 ] || exit 11
	KC_LOCK_PARENT=$$ sh -c "$child" || exit 12
	[ -f "$1/.lock" ] || exit 13
' sh "$T/state" "$ROOT"
rc=$?
case $rc in
	0) pass "re-entrancy: stranger refused (75), KC_LOCK_PARENT child proceeds, lock kept" ;;
	*) fail "re-entrancy (rc=$rc)" ;;
esac
if [ -e "$T/state/.lock" ]; then fail "lock left after owner exit"; else pass "lock released by its owner"; fi

# Tags.
. "$ROOT/deploy/lib.sh"
for t in abc123 0123456789ab v1.2-rc_3; do
	if valid_tag "$t"; then pass "tag $t valid"; else fail "tag $t should be valid"; fi
done
for t in '' blue green next latest 'a b' 'a/b' "$(printf 'a\nb')"; do
	if valid_tag "$t"; then fail "tag '$t' should be rejected"; else pass "tag rejected"; fi
done

if [ "$fails" = 0 ]; then echo "all lock tests passed"; else echo "$fails failure(s)"; exit 1; fi
