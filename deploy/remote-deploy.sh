#!/bin/sh
# SSH forced command for CI deploys. In the VPS's ~/.ssh/authorized_keys:
#   command="<DEPLOY_PATH>/deploy/remote-deploy.sh",no-port-forwarding,no-X11-forwarding,no-agent-forwarding,no-pty ssh-ed25519 AAAA... kitchen-care-ci
# The client sends ONE tar stream on stdin containing:
#   image.tar.gz   output of `docker save | gzip`
#   bundle/        compose.yml, compose.hostport.yml, deploy/ (scripts, nginx config)
# and the image tag as the SSH command (SSH_ORIGINAL_COMMAND). Nothing is built on the VPS.
set -eu

DEPLOY_PATH=$(cd "$(dirname "$0")/.." && pwd)
TAG=${SSH_ORIGINAL_COMMAND:-}
printf '%s' "$TAG" | grep -Eq '^[a-zA-Z0-9._-]{1,64}$' || { echo "remote-deploy: invalid or missing image tag" >&2; exit 2; }

cd "$DEPLOY_PATH"
WORK=$(mktemp -d "$DEPLOY_PATH/.incoming.XXXXXX")
trap 'rm -rf "$WORK"' EXIT

cat >"$WORK/stream.tar"

# Validate every entry before extracting anything: plain files/dirs only, known top-level names,
# no absolute paths, no ".." components, conservative characters.
tar -tvf "$WORK/stream.tar" | cut -c1 | grep -qv '^[-d]$' && { echo "remote-deploy: links/special files not allowed" >&2; exit 2; }
tar -tf "$WORK/stream.tar" | while IFS= read -r name; do
	case $name in
		/* | *..* | *[!A-Za-z0-9._/-]*) echo "remote-deploy: rejected path '$name'" >&2; exit 1 ;;
		image.tar.gz | bundle | bundle/* | ./) ;;
		*) echo "remote-deploy: unexpected entry '$name'" >&2; exit 1 ;;
	esac
done
tar -xf "$WORK/stream.tar" -C "$WORK" --no-same-owner --no-same-permissions
rm -f "$WORK/stream.tar"
[ -f "$WORK/image.tar.gz" ] && [ -d "$WORK/bundle/deploy" ] && [ -f "$WORK/bundle/compose.yml" ] ||
	{ echo "remote-deploy: stream is missing image.tar.gz, bundle/compose.yml or bundle/deploy/" >&2; exit 1; }

echo "remote-deploy: loading image"
gunzip -c "$WORK/image.tar.gz" | docker load >/dev/null
docker image inspect "kitchen-care-app:$TAG" >/dev/null 2>&1 ||
	{ echo "remote-deploy: image kitchen-care-app:$TAG not found after load" >&2; exit 1; }
rm -f "$WORK/image.tar.gz"

# Install files one by one, each via a temp name + rename (this running script keeps its old
# inode). deploy/nginx is a bind-mounted directory, so its files are overwritten in place.
echo "remote-deploy: installing bundle"
for f in compose.yml compose.hostport.yml; do
	[ ! -f "$WORK/bundle/$f" ] || { cp "$WORK/bundle/$f" "$f.new" && mv "$f.new" "$f"; }
done
(cd "$WORK/bundle" && find deploy -type f ! -path 'deploy/local/*') | while IFS= read -r f; do
	mkdir -p "$(dirname "$f")"
	case $f in
		deploy/nginx/*) cp "$WORK/bundle/$f" "$f" ;;
		*) cp "$WORK/bundle/$f" "$f.new" && mv "$f.new" "$f" ;;
	esac
done
chmod +x deploy/*.sh

rm -rf "$WORK"  # exec below skips the EXIT trap
exec "$DEPLOY_PATH/deploy/deploy.sh" "$TAG"
