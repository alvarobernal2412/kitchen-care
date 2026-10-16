#!/bin/sh
# Shared helpers for deploy.sh and rollback.sh. Sourced, not executed. POSIX sh.
# The caller has cd'ed to the deploy root (the directory holding compose.yml and .env).

# The colours and the migrate tool sit in compose profiles so a bare `docker compose up` never
# starts both colours; always deploy through deploy.sh.
COMPOSE_PROFILES=apps,tools
export COMPOSE_PROFILES

STATE_DIR=./state
NGINX_CONF=/etc/nginx/kc-static/nginx.conf
PROXY=kitchen-care-proxy

# Variables that must be set (in .env or the environment) before any deploy. One place.
REQUIRED_VARS="DOMAIN ORIGIN POSTGRES_PASSWORD SESSION_SECRET APP_TIMEZONE NPM_NETWORK"

log() { printf '%s\n' "deploy: $*"; }
die() { printf '%s\n' "deploy: ERROR: $*" >&2; exit 1; }

# env_val NAME: value from the environment, else from ./.env (surrounding quotes stripped).
env_val() {
	eval "_v=\${$1:-}"
	if [ -z "$_v" ] && [ -f .env ]; then
		_v=$(sed -n "s/^[[:space:]]*$1=//p" .env | tail -n 1 | sed -e 's/^"\(.*\)"$/\1/' -e "s/^'\(.*\)'$/\1/")
	fi
	printf '%s' "$_v"
}

validate_env() {
	[ -f .env ] || die ".env not found in $(pwd). Copy deploy/.env.example to .env and fill it in."
	_missing=""
	for _n in $REQUIRED_VARS; do
		[ -n "$(env_val "$_n")" ] || _missing="$_missing $_n"
	done
	[ -z "$_missing" ] || die "missing required variables in .env:$_missing"

	_domain=$(env_val DOMAIN)
	_origin=$(env_val ORIGIN)
	[ "$_origin" = "https://$_domain" ] || die "ORIGIN must be exactly https://$_domain (got $_origin)"
	case $(env_val POSTGRES_PASSWORD) in
		*[!A-Za-z0-9_.~-]*) die "POSTGRES_PASSWORD may only contain A-Z a-z 0-9 _ . ~ - (it is embedded in a URL)" ;;
	esac
	[ "$(printf '%s' "$(env_val SESSION_SECRET)" | wc -c)" -ge 32 ] || die "SESSION_SECRET must be at least 32 characters"
	[ -z "$(env_val BODY_SIZE_LIMIT)" ] || die "do not set BODY_SIZE_LIMIT in .env; the stack fixes it at 6M"

	NPM_NETWORK=$(env_val NPM_NETWORK)
	docker network inspect "$NPM_NETWORK" >/dev/null 2>&1 ||
		die "docker network '$NPM_NETWORK' (NPM_NETWORK) does not exist. Find NPM's network with: docker network ls; docker inspect <npm container> --format '{{json .NetworkSettings.Networks}}'"
}

# check_free_memory: the host is shared and small; two app colours briefly run side by side, so
# refuse to start when less than MIN_FREE_MB (default 400) is available. Skipped without `free`.
check_free_memory() {
	_min=$(env_val MIN_FREE_MB)
	_min=${_min:-400}
	command -v free >/dev/null 2>&1 || return 0
	_avail=$(free -m | awk '/^Mem:/ {print $7}')
	case $_avail in '' | *[!0-9]*) return 0 ;; esac
	[ "$_avail" -ge "$_min" ] || die "only ${_avail} MB memory available (< MIN_FREE_MB=$_min); not starting a second app container. Free memory or lower MIN_FREE_MB."
}

valid_cidr() {
	case $1 in
		*/0) return 1 ;;
		*[!0-9a-fA-F:./]*) return 1 ;;
	esac
	printf '%s' "$1" | grep -Eq '^([0-9]{1,3}\.){3}[0-9]{1,3}/[0-9]{1,2}$|^[0-9a-fA-F:]+/[0-9]{1,3}$'
}

# write_realip: trust X-Forwarded-For only from the NPM network (NPM_SUBNET, else auto-detected).
write_realip() {
	_subnets=$(env_val NPM_SUBNET | tr ',' ' ')
	if [ -z "$_subnets" ]; then
		_subnets=$(docker network inspect -f '{{range .IPAM.Config}}{{.Subnet}} {{end}}' "$NPM_NETWORK")
	fi
	[ -n "$_subnets" ] || die "could not determine the subnet of '$NPM_NETWORK'; set NPM_SUBNET in .env"
	mkdir -p "$STATE_DIR"
	_tmp="$STATE_DIR/.realip.conf.$$"
	: >"$_tmp"
	for _s in $_subnets; do
		valid_cidr "$_s" || die "invalid NPM_SUBNET entry '$_s' (expected CIDR such as 172.20.0.0/16)"
		printf 'set_real_ip_from %s;\n' "$_s" >>"$_tmp"
	done
	mv "$_tmp" "$STATE_DIR/realip.conf"
	log "trusting X-Forwarded-For from: $_subnets"
}

other_color() { [ "$1" = blue ] && echo green || echo blue; }

active_color() {
	if [ -f "$STATE_DIR/active" ]; then cat "$STATE_DIR/active"; fi
}

container_id() { docker compose ps -a -q "app-$1" 2>/dev/null | head -n 1; }

# wait_healthy COLOR: block until the container's Docker health is "healthy" or time runs out.
wait_healthy() {
	_timeout=${HEALTH_TIMEOUT:-120}
	_elapsed=0
	while [ "$_elapsed" -lt "$_timeout" ]; do
		_id=$(container_id "$1")
		_st=none
		[ -z "$_id" ] || _st=$(docker inspect -f '{{if .State.Running}}{{.State.Health.Status}}{{else}}exited{{end}}' "$_id" 2>/dev/null || echo none)
		[ "$_st" != healthy ] || return 0
		[ "$_st" != exited ] || return 1
		sleep 2
		_elapsed=$((_elapsed + 2))
	done
	return 1
}

write_upstream() {
	mkdir -p "$STATE_DIR"
	# shellcheck disable=SC2016  # $kc_upstream is an nginx variable, not a shell one
	printf 'set $kc_upstream "app-%s:3000";\n' "$1" >"$STATE_DIR/.upstream.conf.$$"
	mv "$STATE_DIR/.upstream.conf.$$" "$STATE_DIR/upstream.conf"
}

proxy_reload() {
	docker compose exec -T "$PROXY" nginx -t -c "$NGINX_CONF" >/dev/null 2>&1 || return 1
	docker compose exec -T "$PROXY" nginx -s reload -c "$NGINX_CONF" >/dev/null 2>&1
}

# proxy_ready: the proxy answers /healthz/ready through to the app (a few retries for the reload).
proxy_ready() {
	_i=0
	while [ "$_i" -lt 10 ]; do
		if docker compose exec -T "$PROXY" wget -q -O /dev/null http://127.0.0.1/healthz/ready 2>/dev/null; then
			return 0
		fi
		_i=$((_i + 1))
		sleep 1
	done
	return 1
}

# switch_traffic NEW OLD: point the proxy at NEW (already healthy). On any failure restore OLD's
# upstream (if there was one) and return non-zero; the caller removes NEW.
switch_traffic() {
	_new=$1
	_old=${2:-}
	write_upstream "$_new"
	docker compose up -d --no-recreate "$PROXY" >/dev/null
	if proxy_reload && proxy_ready; then
		return 0
	fi
	log "switch failed; restoring previous upstream"
	if [ -n "$_old" ]; then
		write_upstream "$_old"
		proxy_reload || true
	fi
	return 1
}

with_lock() {
	mkdir -p "$STATE_DIR"
	mkdir "$STATE_DIR/.lock" 2>/dev/null || die "another deploy is running (remove $STATE_DIR/.lock if it is stale)"
	trap 'rmdir "$STATE_DIR/.lock" 2>/dev/null || true' EXIT INT TERM
}
