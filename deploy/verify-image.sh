#!/bin/sh
# Usage: deploy/verify-image.sh <image.tar.gz> <tag>
# Exit 0 only if the archive (output of `docker save | gzip`) contains exactly one image whose
# only RepoTag is kitchen-care-app:<tag>. Run BEFORE `docker load`, so a stream can never re-tag
# another stack's image (postgres:16, nginx, ...). The tag must already be validated.
set -eu

[ $# -eq 2 ] || { echo "usage: $0 <image.tar.gz> <tag>" >&2; exit 2; }
archive=$1
tag=$2

manifest=$(gunzip -c "$archive" 2>/dev/null | tar -xOf - manifest.json 2>/dev/null) || {
	echo "verify-image: cannot read manifest.json from $archive" >&2
	exit 1
}

count=$(printf '%s' "$manifest" | grep -o '"RepoTags"' | wc -l | tr -d ' ')
[ "$count" = 1 ] || { echo "verify-image: expected exactly one image, found $count" >&2; exit 1; }

repotags=$(printf '%s' "$manifest" | grep -o '"RepoTags":[[:space:]]*\[[^]]*\]' | tr -d ' ')
[ "$repotags" = "\"RepoTags\":[\"kitchen-care-app:$tag\"]" ] || {
	echo "verify-image: RepoTags must be exactly [\"kitchen-care-app:$tag\"], got: $repotags" >&2
	exit 1
}
