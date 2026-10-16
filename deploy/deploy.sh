#!/bin/sh
# Blue/green deploy. Usage: deploy/deploy.sh <image-tag>
# Expects the image kitchen-care-app:<image-tag> to exist on this host (update.sh builds it, which
# is the normal entry point). Runs from any directory; operates on the deploy root (parent of
# deploy/), where compose.yml and .env live.
# Failure or interruption at any step before the switch leaves the currently active colour serving.
# Output goes to state/deploy.log as well as stdout (update.sh runs this with its own log instead).
set -eu

[ $# -eq 1 ] || { echo "usage: $0 <image-tag>" >&2; exit 2; }
TAG=$1

cd "$(dirname "$0")/.."
# shellcheck source=deploy/lib.sh
. ./deploy/lib.sh

valid_tag "$TAG" || { echo "invalid or reserved image tag" >&2; exit 2; }
require_flock
validate_env
docker image inspect "kitchen-care-app:$TAG" >/dev/null 2>&1 || die "image kitchen-care-app:$TAG does not exist on this host (build it with deploy/update.sh)"
with_lock
start_logging

OLD=$(active_color)
case $OLD in
	blue | green | '') ;;
	*) die "corrupt $STATE_DIR/active ('$OLD')" ;;
esac
if [ -n "$OLD" ]; then NEW=$(other_color "$OLD"); else NEW=blue; fi
log "image=$TAG active=${OLD:-none} deploying=$NEW"

check_free_memory
warn_orphans
write_realip

# 1. Database up, then migrations with the NEW image. Abort here if they fail.
docker tag "kitchen-care-app:$TAG" kitchen-care-app:next
log "starting postgres"
docker compose up -d --wait postgres >/dev/null
log "running migrations"
docker compose --profile tools run --rm migrate || die "migration failed; nothing changed, ${OLD:-no colour} keeps serving"

# 2. Start the inactive colour on the new image.
docker compose rm -sf "kitchen-care-app-$NEW" >/dev/null 2>&1 || true
docker tag "kitchen-care-app:$TAG" "kitchen-care-app:$NEW"
log "starting kitchen-care-app-$NEW"
PENDING_REMOVE=$NEW
docker compose up -d --no-deps --force-recreate "kitchen-care-app-$NEW" >/dev/null

if ! wait_healthy "$NEW"; then
	log "kitchen-care-app-$NEW did not become healthy; recent logs:"
	docker compose logs --tail 30 "kitchen-care-app-$NEW" || true
	die "deploy aborted; ${OLD:-no colour} keeps serving"
fi

# 3. Switch the proxy, then drain and stop the old colour. From the moment the switch succeeded
# NEW is live: clear the abort marker before anything else, so a failed state write or a signal can
# never make cleanup stop the colour that is serving.
switch_traffic "$NEW" "$OLD" || die "could not switch the proxy to kitchen-care-app-$NEW; ${OLD:-no colour} keeps serving"
PENDING_REMOVE=""
set_active "$NEW"
log "traffic now on kitchen-care-app-$NEW"

if [ -n "$OLD" ]; then
	sleep "$(env_num DRAIN_SECONDS 10)"
	docker compose stop "kitchen-care-app-$OLD" >/dev/null
	log "stopped kitchen-care-app-$OLD (kept for rollback)"
fi

# 4. Prune: keep the colour/next tags and the 3 newest version tags; drop this project's dangling
# layers only (the label is set in the Dockerfile), never other stacks' images.
docker images kitchen-care-app --format '{{.Tag}}' | grep -vE '^(blue|green|next|<none>)$' | tail -n +4 |
	while read -r t; do docker rmi "kitchen-care-app:$t" >/dev/null 2>&1 || true; done
docker image prune -f --filter "label=$PROJECT_LABEL" >/dev/null 2>&1 || true

log "done: $TAG is live on $NEW"
