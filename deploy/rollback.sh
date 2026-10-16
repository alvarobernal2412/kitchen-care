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

CUR=$(active_color)
[ -n "$CUR" ] || die "no active colour recorded; nothing to roll back"
PREV=$(other_color "$CUR")
[ -n "$(container_id "$PREV")" ] || die "app-$PREV no longer exists; redeploy an older image tag with deploy.sh instead"

write_realip
docker compose up -d --wait postgres >/dev/null
log "starting app-$PREV"
docker compose up -d --no-deps "app-$PREV" >/dev/null
if ! wait_healthy "$PREV"; then
	docker compose logs --tail 30 "app-$PREV" || true
	docker compose stop "app-$PREV" >/dev/null 2>&1 || true
	die "app-$PREV is not healthy; $CUR keeps serving"
fi
switch_traffic "$PREV" "$CUR" || { docker compose stop "app-$PREV" >/dev/null 2>&1 || true; die "switch failed; $CUR keeps serving"; }
printf '%s\n' "$PREV" >"$STATE_DIR/active"
sleep "${DRAIN_SECONDS:-10}"
docker compose stop "app-$CUR" >/dev/null
log "rolled back: app-$PREV is live, app-$CUR stopped"
