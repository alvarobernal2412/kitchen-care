#!/bin/sh
# Nightly Postgres dump (custom format, compressed) plus a weekly tar of the uploads volume.
# Usage: deploy/backup.sh   (cron/systemd timer; see deploy/README.md)
# Env: BACKUP_DIR (default /var/backups/kitchen-care), KEEP_DUMPS (14), KEEP_UPLOADS (5),
#      BACKUP_UPLOADS=1 to force the uploads tar (otherwise only on Sundays).
# Exits non-zero on any failure. Copying the files off the host is left to you.
set -eu
umask 077

cd "$(dirname "$0")/.."
# shellcheck source=deploy/lib.sh
. ./deploy/lib.sh

BACKUP_DIR=$(env_val BACKUP_DIR)
BACKUP_DIR=${BACKUP_DIR:-/var/backups/kitchen-care}
KEEP_DUMPS=${KEEP_DUMPS:-14}
KEEP_UPLOADS=${KEEP_UPLOADS:-5}
STAMP=$(date -u +%Y%m%dT%H%M%SZ)

mkdir -p "$BACKUP_DIR"
OUT="$BACKUP_DIR/kitchen-$STAMP.dump"
TMP="$OUT.partial"
trap 'rm -f "$TMP" "$BACKUP_DIR/uploads-$STAMP.tar.gz.partial"' EXIT

docker compose exec -T postgres pg_dump -U kitchen -d kitchen -Fc -Z 6 >"$TMP" || die "pg_dump failed"
[ -s "$TMP" ] || die "pg_dump produced an empty file"
mv "$TMP" "$OUT"
log "wrote $OUT ($(wc -c <"$OUT") bytes)"

# Retention: newest KEEP_DUMPS dumps.
# shellcheck disable=SC2012  # our own timestamped names
ls -1t "$BACKUP_DIR"/kitchen-*.dump 2>/dev/null | tail -n +"$((KEEP_DUMPS + 1))" | while read -r f; do rm -f "$f"; done

if [ "${BACKUP_UPLOADS:-0}" = 1 ] || [ "$(date -u +%u)" = 7 ]; then
	ACTIVE=$(active_color)
	[ -n "$ACTIVE" ] || die "no active app container to read uploads from"
	UP="$BACKUP_DIR/uploads-$STAMP.tar.gz"
	docker compose exec -T "kitchen-care-app-$ACTIVE" tar -czf - -C /data uploads >"$UP.partial" || die "uploads tar failed"
	mv "$UP.partial" "$UP"
	log "wrote $UP"
	# shellcheck disable=SC2012
	ls -1t "$BACKUP_DIR"/uploads-*.tar.gz 2>/dev/null | tail -n +"$((KEEP_UPLOADS + 1))" | while read -r f; do rm -f "$f"; done
fi
