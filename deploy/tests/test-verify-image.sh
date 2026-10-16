#!/bin/sh
# Negative/positive tests for deploy/verify-image.sh and the tag rules. No docker needed.
# Usage: sh deploy/tests/test-verify-image.sh
set -u
cd "$(dirname "$0")/../.." || exit 1
# shellcheck source=deploy/lib.sh
. ./deploy/lib.sh

T=$(mktemp -d)
trap 'rm -rf "$T"' EXIT
fails=0

# mk NAME MANIFEST-JSON: archive containing manifest.json (plus a dummy layer file)
mk() {
	mkdir -p "$T/$1"
	printf '%s' "$2" >"$T/$1/manifest.json"
	echo layer >"$T/$1/layer.tar"
	(cd "$T/$1" && tar -cf - manifest.json layer.tar | gzip >"$T/$1.tar.gz")
}
# expect STATUS NAME TAG DESCRIPTION
expect() {
	sh deploy/verify-image.sh "$T/$2.tar.gz" "$3" >/dev/null 2>&1
	rc=$?
	if { [ "$1" = ok ] && [ $rc -eq 0 ]; } || { [ "$1" = reject ] && [ $rc -ne 0 ]; }; then
		echo "PASS $4"
	else
		echo "FAIL $4 (exit $rc)"
		fails=$((fails + 1))
	fi
}

mk good '[{"Config":"c.json","RepoTags":["kitchen-care-app:abc123"],"Layers":["layer.tar"]}]'
mk other '[{"Config":"c.json","RepoTags":["postgres:16"],"Layers":["layer.tar"]}]'
mk nginx '[{"Config":"c.json","RepoTags":["nginx:1.28-alpine"],"Layers":["layer.tar"]}]'
mk extra '[{"Config":"c.json","RepoTags":["kitchen-care-app:abc123","postgres:16"],"Layers":["layer.tar"]}]'
mk two '[{"RepoTags":["kitchen-care-app:abc123"]},{"RepoTags":["postgres:16"]}]'
mk wrongtag '[{"Config":"c.json","RepoTags":["kitchen-care-app:evil"],"Layers":["layer.tar"]}]'
mk untagged '[{"Config":"c.json","RepoTags":null,"Layers":["layer.tar"]}]'
mkdir -p "$T/nomanifest" && echo x >"$T/nomanifest/layer.tar" && (cd "$T/nomanifest" && tar -cf - layer.tar | gzip >"$T/nomanifest.tar.gz")
echo "not a gzip" >"$T/garbage.tar.gz"

expect ok good abc123 "exact kitchen-care-app:<tag> is accepted"
expect reject other abc123 "re-tagging postgres:16 is refused"
expect reject nginx abc123 "re-tagging nginx is refused"
expect reject extra abc123 "extra RepoTag next to ours is refused"
expect reject two abc123 "second image in the archive is refused"
expect reject wrongtag abc123 "tag different from the validated one is refused"
expect reject untagged abc123 "untagged image is refused"
expect reject nomanifest abc123 "archive without manifest.json is refused"
expect reject garbage abc123 "non-gzip garbage is refused"

tagcheck() { # tagcheck ok|reject TAG DESCRIPTION
	if valid_tag "$2"; then got=ok; else got=reject; fi
	if [ "$got" = "$1" ]; then echo "PASS tag: $3"; else echo "FAIL tag: $3"; fails=$((fails + 1)); fi
}
tagcheck ok abc123.def-1_2 "normal tag"
tagcheck ok 0123456789ab "short sha"
tagcheck reject "" "empty"
tagcheck reject "a
b" "embedded newline"
tagcheck reject "v1;rm" "shell metacharacter"
tagcheck reject "../x" "slash"
tagcheck reject blue "reserved blue"
tagcheck reject green "reserved green"
tagcheck reject next "reserved next"
tagcheck reject latest "reserved latest"
tagcheck reject "$(printf 'a%.0s' $(seq 1 65))" "65 characters"
tagcheck ok "$(printf 'a%.0s' $(seq 1 64))" "64 characters"

if [ "$fails" -eq 0 ]; then echo "all passed"; else echo "$fails failed"; exit 1; fi
