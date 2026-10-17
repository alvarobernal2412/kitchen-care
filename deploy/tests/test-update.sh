#!/bin/sh
# Tests for deploy/update.sh commit selection (DEPLOY_SHA), safety checks and the memory guard,
# against a temp bare repository and a stub `docker` (nothing real is built or started).
# Usage: sh deploy/tests/test-update.sh   (needs git and flock)
set -u
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
command -v flock >/dev/null 2>&1 || { echo "flock (util-linux) is required for this test"; exit 1; }

T=$(mktemp -d)
trap 'rm -rf "$T"' EXIT
fails=0
pass() { printf 'ok   %s\n' "$1"; }
fail() { printf 'FAIL %s\n' "$1"; fails=$((fails + 1)); }

GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@example.com GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@example.com
export GIT_AUTHOR_NAME GIT_AUTHOR_EMAIL GIT_COMMITTER_NAME GIT_COMMITTER_EMAIL

# --- fixture: bare origin, a work copy to push from, a deploy clone, a stub docker ------------
git init -q --bare -b main "$T/origin.git"
git init -q -b main "$T/work"
mkdir -p "$T/work/deploy"
cp -R "$ROOT/deploy/." "$T/work/deploy/"
rm -rf "$T/work/deploy/tests"
printf 'name: kitchen-care\n' >"$T/work/compose.yml"
printf 'FROM scratch\n' >"$T/work/Dockerfile"
printf '.env\nstate/\ndeploy/nginx/*.prev\n' >"$T/work/.gitignore"
git -C "$T/work" remote add origin "$T/origin.git"
commit() { # commit N: new commit on the current work branch; prints its sha
	echo "$1" >"$T/work/note.txt"
	git -C "$T/work" add -A
	git -C "$T/work" commit -q -m "c$1"
	git -C "$T/work" rev-parse HEAD
}
commit 1 >/dev/null
C2=$(commit 2)
C3=$(commit 3)
git -C "$T/work" push -q origin main
git clone -q "$T/origin.git" "$T/clone"
cat >"$T/clone/.env" <<'EOF'
DOMAIN=kitchen.test
ORIGIN=https://kitchen.test
POSTGRES_PASSWORD=throwaway123
SESSION_SECRET=0123456789abcdef0123456789abcdef0123456789abcdef
APP_TIMEZONE=Europe/Zurich
NPM_NETWORK=stub-net
DRAIN_SECONDS=0
EOF

mkdir -p "$T/bin"
cat >"$T/bin/docker" <<'EOF'
#!/bin/sh
# Stub: records calls; images live in $KC_STUB_DIR/images as "name id" lines.
echo "$*" >>"$KC_STUB_DIR/calls"
last() { for a; do :; done; printf '%s' "$a"; }
case $1 in
	build)
		name=''
		while [ $# -gt 0 ]; do [ "$1" = -t ] && name=$2; shift; done
		echo "$name id-$name" >>"$KC_STUB_DIR/images"
		;;
	tag) id=$(grep "^$2 " "$KC_STUB_DIR/images" | tail -n 1 | cut -d' ' -f2); echo "$3 $id" >>"$KC_STUB_DIR/images" ;;
	image)
		if [ "$2" = inspect ]; then
			n=$(last "$@")
			id=$(grep "^$n " "$KC_STUB_DIR/images" | tail -n 1 | cut -d' ' -f2)
			[ -n "$id" ] || exit 1
			echo "$id"
		fi
		;;
	network) case "$*" in *Subnet*) echo "10.9.0.0/24 " ;; esac ;;
	inspect) case "$*" in *Health*) echo healthy ;; *) echo true ;; esac ;;
	compose) case "$*" in *" ps "*"-q"*) echo cid ;; esac ;;
esac
exit 0
EOF
chmod +x "$T/bin/docker"
mkdir -p "$T/stub"
: >"$T/stub/images"
printf 'MemAvailable:    8192000 kB\n' >"$T/meminfo"

# upd [VAR=VALUE ...]: run update.sh in the clone; output to $T/out, status in $rc
upd() {
	: >"$T/stub/calls"
	env PATH="$T/bin:$PATH" KC_STUB_DIR="$T/stub" MEMINFO_FILE="$T/meminfo" "$@" sh "$T/clone/deploy/update.sh" >"$T/out" 2>&1
	rc=$?
}
short() { printf '%s' "$1" | cut -c1-12; }
built() { grep -q "^build .*-t kitchen-care-app:$(short "$1") " "$T/stub/calls"; }
head_is() { [ "$(git -C "$T/clone" rev-parse HEAD)" = "$1" ]; }
expect() { # expect NAME CONDITION-RESULT
	if [ "$2" = 0 ]; then pass "$1"; else fail "$1 (rc=$rc; $(tail -n 2 "$T/out" | tr '\n' ' '))"; fi
}

# 1. Manual run (no DEPLOY_SHA): deploys origin/main.
upd
[ "$rc" = 0 ] && built "$C3" && head_is "$C3"; expect "no DEPLOY_SHA: deploys origin/main ($(short "$C3"))" $?
if [ "$(cat "$T/clone/state/deployed")" = "$(short "$C3")" ]; then r=0; else r=1; fi
expect "deployed commit recorded" $r

[ "$rc" = 0 ] && grep -q "^build .*--build-arg GIT_SHA=$(short "$C3") " "$T/stub/calls"; expect "image build receives GIT_SHA (the 12-char sha)" $?

# 2. Same commit again: already deployed, no build.
upd
[ "$rc" = 0 ] && ! built "$C3" && grep -q "already deployed" "$T/out"; expect "unchanged: already deployed, no build" $?

# 3. Main moves on; DEPLOY_SHA pins the tested commit, not main's tip.
C4=$(commit 4)
C5=$(commit 5)
git -C "$T/work" push -q origin main
upd DEPLOY_SHA="$C4"
[ "$rc" = 0 ] && built "$C4" && ! built "$C5" && head_is "$C4"; expect "DEPLOY_SHA deployed exactly, not main's tip" $?

# 4. An older commit than the deployed one is skipped, nothing changes.
upd DEPLOY_SHA="$C2"
[ "$rc" = 0 ] && ! built "$C2" && head_is "$C4" && grep -q "already contains" "$T/out"; expect "older than deployed: skipped (exit 0), no rollback" $?

# 5. Refusals.
upd DEPLOY_SHA=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
[ "$rc" = 1 ] && grep -q "not a known commit" "$T/out"; expect "unknown SHA refused" $?
upd DEPLOY_SHA=abc123
[ "$rc" = 1 ] && grep -q "40-hex" "$T/out"; expect "short SHA refused" $?
upd DEPLOY_SHA="$(printf '%s' "$C5" | tr 'a-f' 'A-F')"
[ "$rc" = 1 ] && grep -q "40-hex" "$T/out"; expect "uppercase SHA refused" $?
git -C "$T/work" checkout -q -b side
SIDE=$(commit side)
git -C "$T/work" push -q origin side
git -C "$T/clone" fetch -q origin side
upd DEPLOY_SHA="$SIDE"
[ "$rc" = 1 ] && grep -q "not on origin/main" "$T/out" && head_is "$C4"; expect "commit not on origin/main refused" $?
git -C "$T/work" checkout -q main

# 6. Internal marker, tracked .env, wrong branch.
upd
env PATH="$T/bin:$PATH" KC_STUB_DIR="$T/stub" MEMINFO_FILE="$T/meminfo" sh "$T/clone/deploy/update.sh" --pulled >"$T/out" 2>&1
rc=$?
if [ "$rc" = 2 ]; then r=0; else r=1; fi
expect "--pulled without the internal marker refused" $r
git -C "$T/clone" checkout -q -b other
upd FORCE=1
[ "$rc" = 1 ] && grep -q "not on branch main" "$T/out"; expect "clone not on main refused" $?
git -C "$T/clone" checkout -q main
git -C "$T/clone" add -f .env
upd FORCE=1
[ "$rc" = 1 ] && grep -q ".env is tracked" "$T/out"; expect "tracked .env refused" $?
git -C "$T/clone" rm -q --cached .env

# 7. Memory guard: low memory refuses a build; a no-op run does not need memory; fail closed.
C6=$(commit 6)
git -C "$T/work" push -q origin main
printf 'MemAvailable:    100 kB\n' >"$T/meminfo"
upd
[ "$rc" = 1 ] && grep -q "MIN_BUILD_FREE_MB" "$T/out" && ! built "$C6"; expect "low memory: build refused" $?
printf 'MemAvailable:    8192000 kB\n' >"$T/meminfo"
upd
[ "$rc" = 0 ] && built "$C6"; expect "enough memory: deployed" $?
printf 'MemAvailable:    100 kB\n' >"$T/meminfo"
upd
[ "$rc" = 0 ] && grep -q "already deployed" "$T/out"; expect "no-op run on a busy host succeeds" $?
printf 'MemTotal:    8192000 kB\n' >"$T/meminfo"
upd FORCE=1
[ "$rc" = 1 ] && grep -q "cannot read MemAvailable" "$T/out"; expect "unreadable MemAvailable fails closed" $?
upd FORCE=1 MEMINFO_FILE="$T/does-not-exist"
[ "$rc" = 0 ] && grep -q "skipping the memory guard" "$T/out"; expect "no meminfo at all (non-Linux): warn and skip" $?

if [ "$fails" = 0 ]; then echo "all update tests passed"; else echo "$fails failure(s)"; exit 1; fi
