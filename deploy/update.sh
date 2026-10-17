#!/bin/sh
# On-VPS update: pull main (or exactly the commit CI tested), build the image here, then run the
# blue/green deploy. This is the single thing the CI deploy job runs (on the self-hosted runner),
# and what you run by hand. Usage: deploy/update.sh [--help]
set -eu

SELF=$(cd "$(dirname "$0")" && pwd)/$(basename "$0")

usage() {
	cat <<'EOF'
Usage: deploy/update.sh [--help]

Updates this clone (default /opt/kitchen-care) and runs the zero-downtime blue/green deploy
(deploy/deploy.sh) with an image built here as kitchen-care-app:<short sha>.

Steps: require .env and its variables; take the lock; git fetch origin main; reset --hard to
DEPLOY_SHA (the commit CI tested) or, without it, to origin/main (tracked files only: .env,
state/ and the Docker volumes are untouched) and re-run the pulled script; stop if that commit is
already live; refuse when available memory is below MIN_BUILD_FREE_MB (default 900); build with
a capped Node heap (NODE_BUILD_MEMORY_MB, default 768); deploy.sh migrates, health-gates the new
colour, switches traffic, drains and stops the old colour.

Environment:
  DEPLOY_SHA     full 40-hex commit to deploy; must be an ancestor of origin/main. A commit the
                 deployed one already contains is skipped (exit 0), never rolled back to.
  FORCE=1        redeploy even when the active colour already runs this commit
  .env / env     MIN_BUILD_FREE_MB, NODE_BUILD_MEMORY_MB, MIN_FREE_MB, HEALTH_TIMEOUT, DRAIN_SECONDS
  MEMINFO_FILE   alternative to /proc/meminfo (tests)

Needs git, docker with compose, and flock (util-linux).
Exit codes: 0 deployed, already deployed or skipped; 1 failure (the old colour keeps serving);
2 usage; 75 another update/deploy holds the lock; 130/143 interrupted (INT/TERM).
Log: state/update.log
EOF
}

PULLED=0
case ${1:-} in
	-h | --help) usage; exit 0 ;;
	--pulled)
		[ "${KC_UPDATE_REEXEC:-}" = 1 ] || { echo "update.sh: --pulled is internal" >&2; exit 2; }
		PULLED=1
		;;
	'') ;;
	*) usage >&2; exit 2 ;;
esac

cd "$(dirname "$SELF")/.."
# shellcheck source=deploy/lib.sh
. ./deploy/lib.sh

command -v git >/dev/null 2>&1 || die "git is not installed"
command -v docker >/dev/null 2>&1 || die "docker is not installed"
require_flock
validate_env
# Taken before anything changes, held across the re-exec below (same pid) and by the deploy.sh
# child, so two updates can never both reset and build.
with_lock

# Phase 1: choose the commit, then replace the checkout. The script itself may change under
# `git reset`, so it is re-executed afterwards instead of being read on from the old file.
if [ "$PULLED" = 0 ]; then
	git rev-parse --git-dir >/dev/null 2>&1 || die "$(pwd) is not a git clone"
	[ "$(git symbolic-ref --short HEAD 2>/dev/null || true)" = main ] || die "the clone is not on branch main; refusing to reset it"
	if git ls-files --error-unmatch .env >/dev/null 2>&1; then die ".env is tracked by git; refusing to reset (untrack it: git rm --cached .env)"; fi
	log "fetching origin/main"
	git fetch origin main || die "git fetch failed"

	KC_PREV_SHA=$(git rev-parse --short=12 HEAD 2>/dev/null || true)
	TARGET=$(git rev-parse --verify origin/main) || die "origin/main not found"
	if [ -n "${DEPLOY_SHA:-}" ]; then
		case $DEPLOY_SHA in
			*[!0-9a-f]* | '') die "DEPLOY_SHA must be a full lowercase 40-hex commit id" ;;
		esac
		[ "${#DEPLOY_SHA}" -eq 40 ] || die "DEPLOY_SHA must be a full lowercase 40-hex commit id"
		git cat-file -e "$DEPLOY_SHA^{commit}" 2>/dev/null || die "DEPLOY_SHA $DEPLOY_SHA is not a known commit"
		git merge-base --is-ancestor "$DEPLOY_SHA" origin/main || die "DEPLOY_SHA $DEPLOY_SHA is not on origin/main; refusing"
		_dep=$(cat "$STATE_DIR/deployed" 2>/dev/null || true)
		_depfull=""
		[ -z "$_dep" ] || _depfull=$(git rev-parse --verify -q "$_dep^{commit}" 2>/dev/null || true)
		if [ -n "$_depfull" ] && [ "$_depfull" != "$DEPLOY_SHA" ] && git merge-base --is-ancestor "$DEPLOY_SHA" "$_depfull"; then
			log "skipping: the deployed commit $_dep already contains $DEPLOY_SHA (an older run must not roll back a newer deploy)"
			exit 0
		fi
		TARGET=$DEPLOY_SHA
	fi
	log "updating to $TARGET"
	# Keep the last-known-good nginx files; restored on any abort before the switch completes.
	snapshot_nginx_conf
	git reset --hard "$TARGET" || die "git reset failed"
	KC_UPDATE_REEXEC=1
	export KC_PREV_SHA KC_UPDATE_REEXEC
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

# After the no-op decision, so an idle re-run on a busy host does not fail.
check_build_memory

BUILD_MB=$(env_num NODE_BUILD_MEMORY_MB 768)
log "building kitchen-care-app:$TAG (Node heap cap ${BUILD_MB} MB)"
run_child docker build -t "kitchen-care-app:$TAG" --label "$PROJECT_LABEL" \
	--build-arg "NODE_BUILD_MEMORY_MB=$BUILD_MB" --build-arg "GIT_SHA=$TAG" . || die "image build failed; ${ACTIVE:-no colour} keeps serving"

KC_LOGGING=1
export KC_LOGGING
run_child sh ./deploy/deploy.sh "$TAG" || die "deploy failed; ${ACTIVE:-no colour} keeps serving"
drop_nginx_prev
printf '%s\n' "$TAG" >"$STATE_DIR/.deployed.$$" && mv "$STATE_DIR/.deployed.$$" "$STATE_DIR/deployed"
log "update complete: $TAG"
