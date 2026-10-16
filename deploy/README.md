# Deploying Kitchen Care Credits

Target: a small shared VPS that already runs Nginx Proxy Manager (NPM, owns 80/443 and TLS) and
Uptime Kuma on a shared Docker network (`proxy-net`). This stack publishes **no host ports**.

```
push to main -> GitHub CI -> self-hosted runner (container on the VPS) -> deploy/update.sh
browser -> NPM (TLS) -> kitchen-care-proxy:80 -> kitchen-care-app-blue | -green -> postgres
```

`update.sh` runs in a persistent clone on the VPS (default `/opt/kitchen-care`): it pulls
`origin/main`, **builds the image on the VPS**, then runs the zero-downtime blue/green `deploy.sh`.
No SSH key, no forced command, no deploy secrets in GitHub. All containers, volumes and networks
are named `kitchen-care-*`; Postgres is our own private container.

## Prerequisites

Docker with the compose plugin, git, `nice`, about 1 GB of free RAM while building, and NPM. For
auto-deploy: a GitHub repository where you can add Actions variables and a runner.

## One-time VPS setup

1. Clone to the deploy directory. Public repo: `git clone https://github.com/<owner>/<repo>
   /opt/kitchen-care`. Private repo: create a read-only deploy key (Settings > Deploy keys),
   keep the private half in `/root/.ssh`, and clone over SSH.
2. `cd /opt/kitchen-care && cp deploy/.env.example .env && chmod 600 .env`, then fill it in:
   `DOMAIN`, `ORIGIN` (`https://<DOMAIN>`), `POSTGRES_PASSWORD`, `SESSION_SECRET`
   (`openssl rand -hex 32` for both), `APP_TIMEZONE=Europe/Zurich`, `NPM_NETWORK=proxy-net`.
   Find NPM's network with `docker network ls` and
   `docker inspect <npm container> --format '{{json .NetworkSettings.Networks}}'`. The trusted
   proxy subnet is auto-detected from it (`NPM_SUBNET` overrides; a mismatch warns). Trust is by
   network, so attach only your own apps to it; only the proxy joins it, the app colours stay on
   the private network.
3. First deploy by hand: `deploy/update.sh` (builds, migrates, starts blue, starts the proxy).
4. Create the first admin (password from env, never argv, never logged; idempotent):
   ```sh
   read -rs ADMIN_BOOTSTRAP_PASSWORD && export ADMIN_BOOTSTRAP_PASSWORD
   ADMIN_BOOTSTRAP_USERNAME=admin docker compose run --rm \
     -e ADMIN_BOOTSTRAP_USERNAME -e ADMIN_BOOTSTRAP_PASSWORD migrate node scripts/bootstrap-admin.js
   ```
   The password must satisfy the signup policy (8+ chars, upper, lower, digit, symbol).
5. In **NPM** add a Proxy Host: domain `<DOMAIN>`, scheme `http`, Forward Hostname
   `kitchen-care-proxy`, Forward Port `80`, Block Common Exploits on, Websockets off. SSL tab:
   request a certificate, **Force SSL** on. Advanced tab: `client_max_body_size 6m;` (NPM's 1 MB
   default blocks photo uploads).
6. In **Uptime Kuma** add an HTTP(s) monitor `https://<DOMAIN>/healthz`, 60 s, status 200 and
   keyword `"ok":true`.

## Registering the runner

The deploy job runs on a repo-scoped, **ephemeral** self-hosted runner that lives in a container
on the VPS and drives the host's Docker through the mounted socket (docker-outside-of-docker).

1. `mkdir /opt/kitchen-care-runner && cp deploy/runner/docker-compose.yml.example
   /opt/kitchen-care-runner/docker-compose.yml`, copy `deploy/runner/.env.example` to `.env`
   there (`chmod 600`).
2. Edit the compose file: `REPO_URL`, and `<docker-gid>` from `getent group docker`. The deploy
   directory is mounted at the **same absolute path** inside the container, because compose sends
   host paths (`./deploy/nginx`, `./state`) to the host daemon. The `GIT_CONFIG_*` variables set
   `safe.directory=/opt/kitchen-care`, otherwise git refuses to touch a clone owned by another
   user. The `/root/.ssh` mount is optional (private repo over SSH).
3. Put a token in `.env`: `ACCESS_TOKEN` (fine-grained PAT, this repository, Administration
   read/write; lets the runner re-register itself) or a one-hour `RUNNER_TOKEN` (Settings >
   Actions > Runners > New self-hosted runner) for a first test.
4. An ephemeral runner takes one job and exits, so it must be restarted to register again.
   Supervise it with systemd (`/etc/systemd/system/kitchen-care-runner.service`):
   ```ini
   [Unit]
   Description=Kitchen Care GitHub Actions runner
   Requires=docker.service
   After=docker.service
   [Service]
   WorkingDirectory=/opt/kitchen-care-runner
   ExecStart=/usr/bin/docker compose up
   ExecStop=/usr/bin/docker compose down
   Restart=always
   RestartSec=10
   [Install]
   WantedBy=multi-user.target
   ```
   `systemctl daemon-reload && systemctl enable --now kitchen-care-runner`. The runner should show
   as idle with the labels `self-hosted, kitchen-care` in the repository's Actions settings.

## Enabling auto-deploy

Repository variables (Settings > Secrets and variables > Actions > Variables):

| Variable | Meaning |
| --- | --- |
| `DEPLOY_ENABLED` | `true` turns the deploy job on. Until then it is **skipped** (not failed, not queued), so merging before a runner exists is safe. |
| `DEPLOY_DIR` | optional, the clone path if not `/opt/kitchen-care` |
| `DOMAIN` | optional; if set, the job finishes by polling `https://<DOMAIN>/healthz` from the runner |

Create the `production` environment and add required reviewers to it.

## Routine deploys

- **Push to `main`**: CI (lint, types, unit, e2e, docker smoke test) then the deploy job. A newer
  push queues behind a running deploy; deploys are never cancelled mid-flight.
- **By hand from GitHub**: Actions > Deploy > Run workflow (`workflow_dispatch`).
- **By hand on the VPS**: `deploy/update.sh`; `FORCE=1 deploy/update.sh` redeploys the commit that
  is already live (otherwise it prints "already deployed"). `deploy/update.sh --help` lists the
  exit codes. Output also goes to `state/update.log`.

Steps: refuse unless `.env` is complete and `MemAvailable` is at least `MIN_BUILD_FREE_MB`;
`git fetch` + `git reset --hard origin/main` (tracked files only; `.env`, `state/` and volumes are
untouched; the script re-executes itself after the reset); build `kitchen-care-app:<sha>`; migrate
with the new image (failure aborts, old colour keeps serving); start the other colour and wait for
Docker `healthy` (`HEALTH_TIMEOUT`, 120 s); switch the upstream and reload nginx (graceful); after
`DRAIN_SECONDS` (10) stop the old colour. Only one update/deploy runs at a time (lock with the pid;
a dead owner's lock is recovered; a second run exits 75). INT/TERM abort cleanly. The previous
`deploy/nginx` files are restored on any abort before the switch. Any failure leaves the old colour
serving.

Resources: the build happens on the VPS and takes roughly 1-2 minutes of CPU. It runs under
`nice -n 10`, with the Node heap capped by `NODE_BUILD_MEMORY_MB` (768) for the build step only,
and is refused when less than `MIN_BUILD_FREE_MB` (900) of memory is available. Runtime memory:
app 384 MB, postgres 192 MB, proxy 32 MB, runner 1 GB limit. `MIN_FREE_MB` (400) guards the second
colour. Logs rotate (10 MB x 3 per container). All tunables live in `.env` (see `.env.example`).

## Rollback

`deploy/rollback.sh` restarts the previous colour (kept stopped, image intact), checks it is
healthy and switches back. Migrations are not reverted, so keep them backward compatible with the
previous release (add first, remove a release later). To go further back, deploy one of the three
newest kept image tags (`docker images kitchen-care-app`) with `deploy/deploy.sh <tag>`.

## Backups and restore

`deploy/backup.sh` writes `kitchen-<stamp>.dump` (pg_dump custom format) to `BACKUP_DIR` (default
`/var/backups/kitchen-care`), keeps 14, exits non-zero on failure, and on Sundays (or
`BACKUP_UPLOADS=1`) also tars the uploads volume (keeps 5). Nightly via cron:

```
# /etc/cron.d/kitchen-care-backup
15 3 * * * root cd /opt/kitchen-care && ./deploy/backup.sh >>/var/log/kitchen-care-backup.log 2>&1
```

Copying dumps off the VPS is up to you. Restore: stop the app colours first, so nothing writes
while `--clean` recreates the objects, then start the active colour again.

```sh
cd /opt/kitchen-care && export COMPOSE_PROFILES=apps,tools
docker compose stop kitchen-care-app-blue kitchen-care-app-green     # the site shows 502 meanwhile
docker compose exec -T postgres pg_restore -U kitchen -d kitchen --clean --if-exists \
  < /var/backups/kitchen-care/kitchen-<stamp>.dump
docker compose start kitchen-care-app-$(cat state/active)
```

## Trust model

Anyone who can push to `main` or edit the workflow can run code **as root on the VPS** through the
self-hosted runner (it has the Docker socket and the deploy directory). So: enable branch
protection on `main`, put required reviewers on the `production` environment, and never run
untrusted code on this runner. `deploy.yml` runs only on `push` and `workflow_dispatch`, never
`pull_request`; pull requests (including forks) use GitHub-hosted runners in `ci.yml` only.

## Notes and checklist

- `APP_TIMEZONE` buckets analytics by day/hour; set the office zone (`Europe/Zurich`).
- Cutlery detection loads the COCO-SSD model from `https://storage.googleapis.com` in the user's
  browser (allowed by the app's CSP), so clients need that outbound access.
- Photos are served by the app at `/media/*` (authenticated); the uploads volume is never exposed.
- Orphans: earlier versions used generic service names (`app-blue`, `app-green`). `deploy.sh` warns
  about containers of a removed service; remove them with
  `docker compose up -d --remove-orphans postgres kitchen-care-proxy` (name the services, so the
  colours are not started) or `docker rm -f <container>`.
- Security: firewall allows only 22/80/443; SSH key auth only; never publish Postgres (it has no
  `ports`); `.env` and the runner `.env` mode 600; consider `fail2ban`.
- Local try-out without TLS: `deploy/local/compose.local.yml` (an `npm-sim` container stands in
  for NPM on `127.0.0.1:8080`; its header explains the `.env`). Tear down with
  `docker compose --profile '*' down -v`.
