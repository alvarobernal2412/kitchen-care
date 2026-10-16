#!/bin/sh
# SSH forced command for CI deploys. In the VPS's ~/.ssh/authorized_keys:
#   restrict,command="<DEPLOY_PATH>/deploy/remote-deploy.sh",no-pty ssh-ed25519 AAAA... kitchen-care-ci
# The client sends ONE tar stream on stdin containing:
#   image.tar.gz   output of `docker save | gzip`
#   bundle/        compose.yml, deploy/ (scripts, nginx config)
# and the image tag as the SSH command (SSH_ORIGINAL_COMMAND). Nothing is built on the VPS.
# Trust model: whoever holds the key (or can change what CI sends) runs code as the deploy user.
set -eu

DEPLOY_PATH=$(cd "$(dirname "$0")/.." && pwd)
cd "$DEPLOY_PATH"
# shellcheck source=deploy/lib.sh
. ./deploy/lib.sh

# Output to a possibly dead SSH session must never abort the script once the stream is in.
say() { printf '%s\n' "remote-deploy: $*" || true; }
fail() { printf '%s\n' "remote-deploy: ERROR: $*" >&2 || true; exit "${2:-1}"; }

TAG=${SSH_ORIGINAL_COMMAND:-}
valid_tag "$TAG" || fail "invalid or reserved image tag" 2

WORK=""
trap '[ -z "$WORK" ] || rm -rf "$WORK"' EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

MAX_MB=$(env_num MAX_STREAM_MB 800)
MIN_DISK_MB=$(env_num MIN_FREE_DISK_MB 1500)
free_mb=$(df -Pm "$DEPLOY_PATH" | awk 'NR==2 {print $4}')
case $free_mb in '' | *[!0-9]*) free_mb=$MIN_DISK_MB ;; esac
[ "$free_mb" -ge "$MIN_DISK_MB" ] || fail "only ${free_mb} MB free disk (< MIN_FREE_DISK_MB=$MIN_DISK_MB)"

WORK=$(mktemp -d "$DEPLOY_PATH/.incoming.XXXXXX")

# Read at most MAX_MB+1 bytes, so an oversize stream is detected and never fills the disk.
head -c "$((MAX_MB * 1024 * 1024 + 1))" >"$WORK/stream.tar"
size=$(wc -c <"$WORK/stream.tar")
[ "$size" -le "$((MAX_MB * 1024 * 1024))" ] || fail "stream larger than MAX_STREAM_MB=$MAX_MB"

# From here on a dropped SSH connection must not abort a half-finished deploy.
trap '' HUP PIPE

# Validate every entry before extracting anything: plain files/dirs only, known top-level names,
# no absolute paths, no ".." components, conservative characters.
if tar -tvf "$WORK/stream.tar" | cut -c1 | grep -qv '^[-d]$'; then fail "links/special files not allowed"; fi
tar -tf "$WORK/stream.tar" | while IFS= read -r name; do
	case $name in
		/* | *..* | *[!A-Za-z0-9._/-]*) fail "rejected path '$name'" ;;
		image.tar.gz | bundle | bundle/* | ./) ;;
		*) fail "unexpected entry '$name'" ;;
	esac
done
tar -xf "$WORK/stream.tar" -C "$WORK" --no-same-owner --no-same-permissions
rm -f "$WORK/stream.tar"
[ -f "$WORK/image.tar.gz" ] && [ -d "$WORK/bundle/deploy" ] && [ -f "$WORK/bundle/compose.yml" ] ||
	fail "stream is missing image.tar.gz, bundle/compose.yml or bundle/deploy/"

# The archive may only carry kitchen-care-app:<TAG>; never let a stream re-tag another stack's image.
sh ./deploy/verify-image.sh "$WORK/image.tar.gz" "$TAG" || fail "image archive rejected"

say "loading image"
gunzip -c "$WORK/image.tar.gz" | docker load >/dev/null
docker image inspect "kitchen-care-app:$TAG" >/dev/null 2>&1 || fail "image kitchen-care-app:$TAG not found after load"
rm -f "$WORK/image.tar.gz"

# Install files one by one, each via a temp name + rename (this running script keeps its old
# inode). For deploy/nginx (a bind-mounted directory) the previous good copy is kept as *.prev so
# deploy.sh can restore it if `nginx -t` rejects the new one.
say "installing bundle"
install_file() { # install_file RELATIVE-PATH
	mkdir -p "$(dirname "$1")"
	case $1 in
		deploy/nginx/*)
			[ ! -f "$1" ] || cp -p "$1" "$1.prev"
			;;
	esac
	cp "$WORK/bundle/$1" "$1.new" && mv "$1.new" "$1"
}
install_file compose.yml
(cd "$WORK/bundle" && find deploy -type f ! -path 'deploy/local/*') | while IFS= read -r f; do
	install_file "$f"
done
chmod +x deploy/*.sh deploy/tests/*.sh 2>/dev/null || true

rm -rf "$WORK"
WORK=""
exec "$DEPLOY_PATH/deploy/deploy.sh" "$TAG"
