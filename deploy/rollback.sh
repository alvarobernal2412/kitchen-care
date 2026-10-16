#!/bin/sh
# Switch back to the previous colour (kept stopped by deploy.sh). Usage: deploy/rollback.sh
# Database migrations are NOT reverted; keep migrations backward compatible with the previous
# release (add columns first, remove them a release later).
set -eu

cd "$(dirname "$0")/.."
# shellcheck source=deploy/lib.sh
. ./deploy/lib.sh

validate_env
with_lock
start_logging

CUR=$(active_color)
[ -n "$CUR" ] || die "no active colour recorded; nothing to roll back"
PREV=$(other_color "$CUR")
[ -n "$(container_id "$PREV")" ] || die "kitchen-care-app-$PREV no longer exists; redeploy an older image tag with deploy.sh instead"

write_realip
docker compose up -d --wait postgres >/dev/null
log "starting kitchen-care-app-$PREV"
PENDING_STOP=$PREV
docker compose up -d --no-deps "kitchen-care-app-$PREV" >/dev/null
if ! wait_healthy "$PREV"; then
	docker compose logs --tail 30 "kitchen-care-app-$PREV" || true
	die "kitchen-care-app-$PREV is not healthy; $CUR keeps serving"
fi
switch_traffic "$PREV" "$CUR" || die "switch failed; $CUR keeps serving"
PENDING_STOP=""
set_active "$PREV"
sleep "$(env_num DRAIN_SECONDS 10)"
docker compose stop "kitchen-care-app-$CUR" >/dev/null
log "rolled back: kitchen-care-app-$PREV is live, kitchen-care-app-$CUR stopped"
