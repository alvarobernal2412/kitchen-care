#!/bin/sh
# Blue/green deploy. Usage: deploy/deploy.sh <image-tag>
# Expects the image kitchen-care-app:<image-tag> to be loaded already (docker load). Runs from any
# directory; operates on the deploy root (parent of deploy/), where compose.yml and .env live.
# Failure at any step before the switch leaves the currently active colour serving.
set -eu

[ $# -eq 1 ] || { echo "usage: $0 <image-tag>" >&2; exit 2; }
TAG=$1
case $TAG in
	*[!A-Za-z0-9_.-]* | '') echo "invalid image tag" >&2; exit 2 ;;
esac

cd "$(dirname "$0")/.."
# shellcheck source=deploy/lib.sh
. ./deploy/lib.sh

validate_env
docker image inspect "kitchen-care-app:$TAG" >/dev/null 2>&1 || die "image kitchen-care-app:$TAG is not loaded on this host"
with_lock

OLD=$(active_color)
case $OLD in
	blue | green | '') ;;
	*) die "corrupt $STATE_DIR/active ('$OLD')" ;;
esac
if [ -n "$OLD" ]; then NEW=$(other_color "$OLD"); else NEW=blue; fi
log "image=$TAG active=${OLD:-none} deploying=$NEW"

check_free_memory
write_realip

# 1. Database up, then migrations with the NEW image. Abort here if they fail.
docker tag "kitchen-care-app:$TAG" kitchen-care-app:next
log "starting postgres"
docker compose up -d --wait postgres >/dev/null
log "running migrations"
docker compose --profile tools run --rm migrate || die "migration failed; nothing changed, $OLD keeps serving"

# 2. Start the inactive colour on the new image.
docker compose rm -sf "app-$NEW" >/dev/null 2>&1 || true
docker tag "kitchen-care-app:$TAG" "kitchen-care-app:$NEW"
log "starting app-$NEW"
docker compose up -d --no-deps --force-recreate "app-$NEW" >/dev/null

if ! wait_healthy "$NEW"; then
	log "app-$NEW did not become healthy; recent logs:"
	docker compose logs --tail 30 "app-$NEW" || true
	docker compose rm -sf "app-$NEW" >/dev/null 2>&1 || true
	die "deploy aborted; ${OLD:-no colour} keeps serving"
fi

# 3. Switch the proxy, then drain and stop the old colour.
if ! switch_traffic "$NEW" "$OLD"; then
	docker compose rm -sf "app-$NEW" >/dev/null 2>&1 || true
	die "could not switch the proxy to app-$NEW; ${OLD:-no colour} keeps serving"
fi
printf '%s\n' "$NEW" >"$STATE_DIR/active"
log "traffic now on app-$NEW"

if [ -n "$OLD" ]; then
	sleep "${DRAIN_SECONDS:-10}"
	docker compose stop "app-$OLD" >/dev/null
	log "stopped app-$OLD (kept for rollback)"
fi

# 4. Prune: keep the colour/next tags and the 3 newest version tags; drop dangling layers.
docker images kitchen-care-app --format '{{.Tag}}' | grep -vE '^(blue|green|next|<none>)$' | tail -n +4 |
	while read -r t; do docker rmi "kitchen-care-app:$t" >/dev/null 2>&1 || true; done
docker image prune -f >/dev/null 2>&1 || true

log "done: $TAG is live on $NEW"
