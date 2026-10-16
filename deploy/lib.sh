#!/bin/sh
# Shared helpers for deploy.sh, rollback.sh, backup.sh and update.sh. Sourced, not executed.
# POSIX sh. The caller has cd'ed to the deploy root (the directory holding compose.yml and .env).

# The colours and the migrate tool sit in compose profiles so a bare `docker compose up` never
# starts both colours; always deploy through update.sh or deploy.sh.
COMPOSE_PROFILES=apps,tools
export COMPOSE_PROFILES

STATE_DIR=${KC_STATE_DIR:-./state}
NGINX_CONF=/etc/nginx/kc-static/nginx.conf
PROXY=kitchen-care-proxy
# shellcheck disable=SC2034  # used by deploy.sh and update.sh
PROJECT_LABEL=com.kitchen-care.project=kitchen-care

# Variables that must be set (in .env or the environment) before any deploy. One place.
REQUIRED_VARS="DOMAIN ORIGIN POSTGRES_PASSWORD SESSION_SECRET APP_TIMEZONE NPM_NETWORK"

log() { printf '%s\n' "deploy: $*"; }
warn() { printf '%s\n' "deploy: WARNING: $*" >&2; }
die() { printf '%s\n' "deploy: ERROR: $*" >&2; exit 1; }

# env_val NAME: value from the environment, else from ./.env (surrounding quotes stripped).
env_val() {
	eval "_v=\${$1:-}"
	if [ -z "$_v" ] && [ -f .env ]; then
		_v=$(sed -n "s/^[[:space:]]*$1=//p" .env | tail -n 1 | sed -e 's/^"\(.*\)"$/\1/' -e "s/^'\(.*\)'$/\1/")
	fi
	printf '%s' "$_v"
}

# env_num NAME DEFAULT: numeric tunable from the environment/.env, falling back to DEFAULT.
env_num() {
	_n=$(env_val "$1")
	case $_n in '' | *[!0-9]*) _n=$2 ;; esac
	printf '%s' "$_n"
}

# valid_tag TAG: single-line check, 1-64 chars of [A-Za-z0-9._-], not a reserved tag.
valid_tag() {
	case $1 in
		'' | *[!A-Za-z0-9._-]*) return 1 ;;
		blue | green | next | latest) return 1 ;;
	esac
	[ "${#1}" -le 64 ]
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

# mem_available_mb: available host memory in MB (MemAvailable), empty when it cannot be read.
mem_available_mb() {
	if [ -r /proc/meminfo ] && grep -q '^MemAvailable:' /proc/meminfo 2>/dev/null; then
		awk '/^MemAvailable:/ {printf "%d", $2 / 1024}' /proc/meminfo
	elif command -v free >/dev/null 2>&1; then
		free -m | awk '/^Mem:/ {print $7}'
	fi
}

# check_free_memory: the host is shared and small; two app colours briefly run side by side, so
# refuse to start when less than MIN_FREE_MB (default 400) is available. Skipped when unreadable.
check_free_memory() {
	_min=$(env_num MIN_FREE_MB 400)
	_avail=$(mem_available_mb)
	case $_avail in '' | *[!0-9]*) return 0 ;; esac
	[ "$_avail" -ge "$_min" ] || die "only ${_avail} MB memory available (< MIN_FREE_MB=$_min); not starting a second app container. Free memory or lower MIN_FREE_MB."
}

# check_build_memory: building the image on the VPS needs headroom; refuse below MIN_BUILD_FREE_MB
# (default 900) so the Vite build cannot starve the other apps. Skipped when unreadable.
check_build_memory() {
	_min=$(env_num MIN_BUILD_FREE_MB 900)
	_avail=$(mem_available_mb)
	case $_avail in
		'' | *[!0-9]*)
			warn "cannot read available memory; skipping the build memory guard"
			return 0
			;;
	esac
	[ "$_avail" -ge "$_min" ] || die "only ${_avail} MB memory available (< MIN_BUILD_FREE_MB=$_min); not building now. Retry later, stop something, or lower MIN_BUILD_FREE_MB in .env."
}

valid_cidr() {
	case $1 in
		*/0) return 1 ;;
		*[!0-9a-fA-F:./]*) return 1 ;;
	esac
	printf '%s' "$1" | grep -Eq '^([0-9]{1,3}\.){3}[0-9]{1,3}/[0-9]{1,2}$|^[0-9a-fA-F:]+/[0-9]{1,3}$'
}

# write_realip: trust X-Forwarded-For only from the NPM network. The subnet is auto-detected from
# NPM_NETWORK; an explicit NPM_SUBNET overrides it (and warns loudly when it does not match).
write_realip() {
	_detected=$(docker network inspect -f '{{range .IPAM.Config}}{{.Subnet}} {{end}}' "$NPM_NETWORK")
	_subnets=$(env_val NPM_SUBNET | tr ',' ' ')
	if [ -z "$_subnets" ]; then
		_subnets=$_detected
	else
		for _s in $_subnets; do
			case " $_detected " in
				*" $_s "*) ;;
				*) warn "NPM_SUBNET entry $_s does not match the subnet(s) of network '$NPM_NETWORK' ($_detected). Client IPs may be wrong or spoofable; remove NPM_SUBNET to auto-detect." ;;
			esac
		done
	fi
	[ -n "$_subnets" ] || die "could not determine the subnet of '$NPM_NETWORK'; set NPM_SUBNET in .env"
	mkdir -p "$STATE_DIR"
	_tmp="$STATE_DIR/.realip.conf.$$"
	: >"$_tmp"
	for _s in $_subnets; do
		valid_cidr "$_s" || die "invalid subnet '$_s' (expected CIDR such as 172.20.0.0/16)"
		printf 'set_real_ip_from %s;\n' "$_s" >>"$_tmp"
	done
	mv "$_tmp" "$STATE_DIR/realip.conf"
	log "trusting X-Forwarded-For from: $_subnets"
}

other_color() { [ "$1" = blue ] && echo green || echo blue; }

active_color() {
	if [ -f "$STATE_DIR/active" ]; then cat "$STATE_DIR/active"; fi
}

# set_active COLOR: record the live colour (temp file + rename, so it is never half written).
set_active() {
	mkdir -p "$STATE_DIR"
	printf '%s\n' "$1" >"$STATE_DIR/.active.$$"
	mv "$STATE_DIR/.active.$$" "$STATE_DIR/active"
}

container_id() { docker compose ps -a -q "kitchen-care-app-$1" 2>/dev/null | head -n 1; }

# warn_orphans: containers of this compose project whose service no longer exists in compose.yml,
# e.g. the generic app-blue/app-green services of earlier versions. They keep running (and keep
# memory) until removed by hand.
warn_orphans() {
	_known=$(docker compose --profile '*' config --services 2>/dev/null | tr '\n' ' ')
	[ -n "$_known" ] || return 0
	for _s in $(docker compose ps -a --format '{{.Service}}' 2>/dev/null | sort -u); do
		case " $_known " in
			*" $_s "*) ;;
			*) warn "orphan container for removed service '$_s' (an older version?). Remove it with: docker compose up -d --remove-orphans postgres kitchen-care-proxy   (or docker rm -f <container>; see docker compose ps -a)" ;;
		esac
	done
}

# wait_healthy COLOR: block until the container's Docker health is "healthy" or time runs out.
wait_healthy() {
	_timeout=$(env_num HEALTH_TIMEOUT 120)
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

# The colours are reachable on the private network under their compose service names, which carry
# the project prefix so they cannot collide with other stacks' names (the app is never attached to
# the shared NPM network).
write_upstream() {
	mkdir -p "$STATE_DIR"
	# shellcheck disable=SC2016  # $kc_upstream is an nginx variable, not a shell one
	printf 'set $kc_upstream "kitchen-care-app-%s:3000";\n' "$1" >"$STATE_DIR/.upstream.conf.$$"
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

# --- nginx files: last-known-good copies ----------------------------------------------------
# deploy/nginx is bind-mounted into the proxy and arrives by `git reset`, so a bad commit changes
# the files under a running proxy. update.sh snapshots them as *.prev first; they are restored on
# every abort before the switch completes and dropped once the new ones are live.

# snapshot_nginx_conf: leftovers from a killed run are the last known good (restore them first),
# then copy the current files; an existing *.prev is never overwritten with unvalidated files.
snapshot_nginx_conf() {
	restore_nginx_conf
	for _f in deploy/nginx/*; do
		case $_f in *.prev) continue ;; esac
		[ -f "$_f" ] || continue
		cp -p "$_f" "$_f.prev"
	done
}

# restore_nginx_conf: put back the previous nginx files kept as *.prev (no-op without any).
restore_nginx_conf() {
	for _f in deploy/nginx/*.prev; do
		[ -f "$_f" ] || continue
		mv -f "$_f" "${_f%.prev}"
		log "restored ${_f%.prev} from its previous copy"
	done
}

# drop_nginx_prev: the new nginx files passed `nginx -t`; the previous copies are no longer needed.
drop_nginx_prev() { rm -f deploy/nginx/*.prev; }

# switch_traffic NEW OLD: point the proxy at NEW (already healthy). On any failure restore OLD's
# upstream and the nginx files and return non-zero; the caller removes NEW. Without an OLD (first
# deploy) the proxy is reloaded onto the restored files so the running config matches the disk.
# SWITCH_ACTIVE lets the exit trap undo a half-done switch when a signal arrives mid-way.
switch_traffic() {
	_new=$1
	_old=${2:-}
	SWITCH_OLD=$_old
	SWITCH_ACTIVE=1
	write_upstream "$_new"
	docker compose up -d --no-recreate "$PROXY" >/dev/null
	if proxy_reload && proxy_ready; then
		SWITCH_ACTIVE=0
		SWITCH_DONE=1
		drop_nginx_prev
		return 0
	fi
	log "switch failed; restoring previous upstream and nginx files"
	restore_nginx_conf
	if [ -n "$_old" ]; then
		write_upstream "$_old"
		proxy_reload || true
	else
		# First deploy: the proxy may have started on the rejected files (and be crash-looping);
		# restart it so what runs is what is on disk.
		docker compose restart "$PROXY" >/dev/null 2>&1 || true
	fi
	SWITCH_ACTIVE=0
	return 1
}

# --- locking, signals, logging -------------------------------------------------------------

LOCK_FILE=$STATE_DIR/.lock
LOCK_OWNER=""       # pid if this process created the lock file (and so removes it)
HAVE_LOCK=0         # 1 once this run is entitled to act (owner, re-entry, or told child)
SWITCH_ACTIVE=0
SWITCH_DONE=0
SWITCH_OLD=""
PENDING_REMOVE=""   # colour started by this run but not yet live: removed on abort
PENDING_STOP=""     # colour started by a rollback but not yet live: stopped on abort
TAIL_PID=""
CHILD_PID=""

# run_child CMD...: run a command in the background and wait for it, so a trapped INT/TERM is
# handled immediately (a foreground child would delay the trap until it exits). cleanup forwards
# the signal to the child and waits for it.
run_child() {
	"$@" &
	CHILD_PID=$!
	_rc=0
	wait "$CHILD_PID" || _rc=$?
	CHILD_PID=""
	return "$_rc"
}

cleanup() {
	# A run that never got the lock (refused, or interrupted while waiting) must not touch anything:
	# the nginx files, colours and state belong to whoever holds the lock.
	if [ "$HAVE_LOCK" != 1 ]; then
		rm -f "$LOCK_FILE.$$"
		return 0
	fi
	if [ -n "$CHILD_PID" ]; then
		kill -TERM "$CHILD_PID" 2>/dev/null || true
		wait "$CHILD_PID" 2>/dev/null || true
	fi
	# Undo a half-done switch first, so a signal never leaves the upstream on an unverified colour.
	if [ "$SWITCH_ACTIVE" = 1 ] && [ -n "$SWITCH_OLD" ]; then
		write_upstream "$SWITCH_OLD" 2>/dev/null || true
	fi
	# Every abort before the switch completed puts the last-known-good nginx files back.
	if [ "$SWITCH_DONE" != 1 ]; then restore_nginx_conf 2>/dev/null || true; fi
	if [ "$SWITCH_ACTIVE" = 1 ]; then
		if [ -n "$SWITCH_OLD" ]; then proxy_reload 2>/dev/null || true; else docker compose restart "$PROXY" >/dev/null 2>&1 || true; fi
	fi
	# Once the switch succeeded the pending colour is the live one and must never be touched.
	if [ "$SWITCH_DONE" != 1 ]; then
		[ -z "$PENDING_REMOVE" ] || docker compose rm -sf "kitchen-care-app-$PENDING_REMOVE" >/dev/null 2>&1 || true
		[ -z "$PENDING_STOP" ] || docker compose stop "kitchen-care-app-$PENDING_STOP" >/dev/null 2>&1 || true
	fi
	rm -f "$LOCK_FILE.$$"
	# Only remove a lock this process owns.
	if [ -n "$LOCK_OWNER" ] && [ "$(lock_pid)" = "$LOCK_OWNER" ]; then
		rm -f "$LOCK_FILE"
	fi
	if [ -n "$TAIL_PID" ]; then
		sleep 1 # let the follower print the last lines
		kill "$TAIL_PID" 2>/dev/null || true
	fi
}

lock_pid() { sed -n '1p' "$LOCK_FILE" 2>/dev/null || true; }

# with_lock: take the deploy lock, a file "pid / start time" that is created complete and
# atomically (written to a temp name, then hard-linked into place, which fails if it exists), so
# there is never a lock without a pid. A lock whose pid is dead is stale; contenders recover it
# one at a time through a "takeover" link and re-check the lock under it, so two of them can never
# both remove it and both proceed. Exits 75 when a live deploy holds the lock.
# The lock is re-entrant for the process that holds it (update.sh re-executes itself) and for the
# direct child of the holder that was told so (KC_LOCK_PARENT, set by update.sh for deploy.sh).
# Also installs the signal handling for the rest of the run: INT/TERM clean up and exit (the
# deploy never continues), HUP/PIPE are ignored so a dropped session does not abort a half-finished
# switch.
with_lock() {
	mkdir -p "$STATE_DIR"
	trap cleanup EXIT
	trap 'exit 130' INT
	trap 'exit 143' TERM
	trap '' HUP PIPE

	_held=$(lock_pid)
	if [ -n "$_held" ]; then
		if [ "$_held" = "$$" ]; then
			LOCK_OWNER=$$
			HAVE_LOCK=1
			return 0
		fi
		if [ "${KC_LOCK_PARENT:-}" = "$_held" ] && [ "$_held" = "$PPID" ]; then
			HAVE_LOCK=1
			return 0
		fi
	fi

	_tmp="$LOCK_FILE.$$"
	printf '%s\n%s\n' "$$" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" >"$_tmp"
	_tries=0
	while :; do
		if ln "$_tmp" "$LOCK_FILE" 2>/dev/null; then
			rm -f "$_tmp"
			LOCK_OWNER=$$
			HAVE_LOCK=1
			return 0
		fi
		_pid=$(lock_pid)
		if [ -n "$_pid" ] && kill -0 "$_pid" 2>/dev/null; then
			rm -f "$_tmp"
			printf '%s\n' "deploy: ERROR: another deploy is running (pid $_pid, started $(sed -n '2p' "$LOCK_FILE" 2>/dev/null || echo unknown))" >&2
			exit 75
		fi
		if [ -n "$_pid" ]; then
			if ln "$_tmp" "$LOCK_FILE.takeover" 2>/dev/null; then
				if [ "$(lock_pid)" = "$_pid" ]; then
					log "removing stale lock (pid $_pid is not running)"
					rm -f "$LOCK_FILE"
				fi
				rm -f "$LOCK_FILE.takeover"
			else
				# Someone else is recovering; if that contender died mid-way, clear its marker.
				_tp=$(sed -n '1p' "$LOCK_FILE.takeover" 2>/dev/null || true)
				if [ -n "$_tp" ] && ! kill -0 "$_tp" 2>/dev/null; then rm -f "$LOCK_FILE.takeover"; fi
				sleep 1
			fi
		fi
		_tries=$((_tries + 1))
		if [ "$_tries" -ge 15 ]; then
			rm -f "$_tmp"
			die "could not take the deploy lock"
		fi
	done
}

# start_logging [NAME]: from here on all output goes to state/NAME.log (default deploy.log) and is
# mirrored to the original stdout by a follower process. If the controlling session drops, only the
# follower dies; the run keeps writing to the file and finishes. KC_LOGGING=1 (set by update.sh
# for its deploy.sh child, which already writes to update.log) turns this into a no-op.
start_logging() {
	[ -z "${KC_LOGGING:-}" ] || return 0
	mkdir -p "$STATE_DIR"
	_log=$STATE_DIR/${1:-deploy}.log
	if [ -f "$_log" ] && [ "$(wc -c <"$_log")" -gt 1048576 ]; then : >"$_log"; fi
	: >>"$_log"
	_off=$(wc -c <"$_log")
	tail -c "+$((_off + 1))" -f "$_log" &
	TAIL_PID=$!
	exec >>"$_log" 2>&1
	log "---- $(date -u +%Y-%m-%dT%H:%M:%SZ) pid $$ ----"
}
