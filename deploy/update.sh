#!/bin/sh
# On-VPS update: pull the latest main, build the image here, then run the blue/green deploy.
# This is the single thing the CI deploy job runs (on the self-hosted runner), and what you run
# by hand. Usage: deploy/update.sh [--help]    Env: FORCE=1 redeploys even if already live.
set -eu

SELF=$(cd "$(dirname "$0")" && pwd)/$(basename "$0")

usage() {
	cat <<'EOF'
Usage: deploy/update.sh [--help]

Updates this clone (default /opt/kitchen-care) to origin/main, builds kitchen-care-app:<short sha>
locally, and runs the zero-downtime blue/green deploy (deploy/deploy.sh).

Steps: require .env and its variables; refuse when available memory is below MIN_BUILD_FREE_MB
(default 900); git fetch + reset --hard origin/main (tracked files only: .env, state/ and the
Docker volumes are untouched) and re-run the pulled script; build with nice and a capped Node heap
(NODE_BUILD_MEMORY_MB, default 768); deploy.sh migrates, health-gates the new colour, switches
traffic, drains and stops the old colour.

Environment:
  FORCE=1        redeploy even when the active colour already runs this commit
  .env / env     MIN_BUILD_FREE_MB, NODE_BUILD_MEMORY_MB, MIN_FREE_MB, HEALTH_TIMEOUT, DRAIN_SECONDS

Exit codes: 0 deployed or already deployed; 1 failure (the old colour keeps serving);
2 usage; 75 another update/deploy holds the lock; 130/143 interrupted (INT/TERM).
Log: state/update.log
EOF
}

PULLED=0
case ${1:-} in
	-h | --help) usage; exit 0 ;;
	--pulled) PULLED=1 ;;
	'') ;;
	*) usage >&2; exit 2 ;;
esac

cd "$(dirname "$SELF")/.."
# shellcheck source=deploy/lib.sh
. ./deploy/lib.sh

command -v git >/dev/null 2>&1 || die "git is not installed"
command -v docker >/dev/null 2>&1 || die "docker is not installed"
validate_env
# Taken before anything changes, held across the re-exec below (same pid) and shared with the
# deploy.sh child, so two updates can never both reset and build.
with_lock

# Phase 1: guard, then replace the checkout. The script itself may change under `git reset`, so it
# is re-executed afterwards instead of being read on from the old file.
if [ "$PULLED" = 0 ]; then
	check_build_memory
	git rev-parse --git-dir >/dev/null 2>&1 || die "$(pwd) is not a git clone"
	snapshot_nginx_conf
	KC_PREV_SHA=$(git rev-parse --short=12 HEAD 2>/dev/null || true)
	export KC_PREV_SHA
	log "fetching origin/main"
	git fetch origin main || die "git fetch failed"
	git reset --hard origin/main || die "git reset failed"
	exec sh "$SELF" --pulled
fi

start_logging update

# Phase 2: build and deploy the pulled commit.
TAG=$(git rev-parse --short=12 HEAD)
valid_tag "$TAG" || die "cannot derive a valid image tag from the commit ($TAG)"
log "commit $TAG (previously ${KC_PREV_SHA:-unknown})"

ACTIVE=$(active_color)
case $ACTIVE in
	blue | green | '') ;;
	*) die "corrupt $STATE_DIR/active ('$ACTIVE')" ;;
esac

# already_deployed: the last successful update was this commit, the active colour is running and
# its image is the one tagged $TAG. (Not judged by image identity alone: a commit that only changes
# deploy/ or compose.yml builds the same image but still has to be applied.)
already_deployed() {
	[ -n "$ACTIVE" ] || return 1
	[ "$(cat "$STATE_DIR/deployed" 2>/dev/null || true)" = "$TAG" ] || return 1
	_img=$(docker image inspect -f '{{.Id}}' "kitchen-care-app:$TAG" 2>/dev/null) || return 1
	_live=$(docker image inspect -f '{{.Id}}' "kitchen-care-app:$ACTIVE" 2>/dev/null) || return 1
	[ -n "$_img" ] && [ "$_img" = "$_live" ] || return 1
	_cid=$(container_id "$ACTIVE")
	[ -n "$_cid" ] && [ "$(docker inspect -f '{{.State.Running}}' "$_cid" 2>/dev/null)" = true ]
}

if [ "${FORCE:-0}" != 1 ] && already_deployed; then
	drop_nginx_prev
	log "already deployed: $TAG is live on $ACTIVE (FORCE=1 to redeploy)"
	exit 0
fi

BUILD_MB=$(env_num NODE_BUILD_MEMORY_MB 768)
log "building kitchen-care-app:$TAG (Node heap cap ${BUILD_MB} MB)"
if command -v nice >/dev/null 2>&1; then NICE="nice -n 10"; else NICE=""; fi
# shellcheck disable=SC2086  # NICE is deliberately word-split
run_child $NICE docker build -t "kitchen-care-app:$TAG" --label "$PROJECT_LABEL" \
	--build-arg "NODE_BUILD_MEMORY_MB=$BUILD_MB" . || die "image build failed; ${ACTIVE:-no colour} keeps serving"

KC_LOCK_PARENT=$$
KC_LOGGING=1
export KC_LOCK_PARENT KC_LOGGING
run_child sh ./deploy/deploy.sh "$TAG" || die "deploy failed; ${ACTIVE:-no colour} keeps serving"
drop_nginx_prev
printf '%s\n' "$TAG" >"$STATE_DIR/.deployed.$$" && mv "$STATE_DIR/.deployed.$$" "$STATE_DIR/deployed"
log "update complete: $TAG"
