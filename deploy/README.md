# Deploying Kitchen Care Credits

Target: a small shared VPS that already runs Nginx Proxy Manager (NPM, owns 80/443 and TLS) and
Uptime Kuma on a shared Docker network (`proxy-net`). This stack publishes **no host ports**.

```
push to main -> CI -> self-hosted runner (container on the VPS) -> deploy/update.sh
browser -> NPM (TLS) -> kitchen-care-proxy:80 -> kitchen-care-app-blue | -green -> postgres
```
`update.sh` runs in a persistent clone on the VPS (default `/opt/kitchen-care`): it pulls the
commit CI tested (or `origin/main` by hand), **builds the image on the VPS**, then runs the zero-downtime blue/green `deploy.sh`.
No SSH key, no forced command, no deploy secrets in GitHub. All containers, volumes and networks
are named `kitchen-care-*`; Postgres is our own private container.

## Prerequisites

Docker with the compose plugin, git, `flock` (package `util-linux`), about 1 GB of free RAM while
building, and NPM. For auto-deploy: a GitHub repository where you can add Actions variables and a
runner.

## One-time VPS setup

1. Clone to the deploy directory. Public repo: `git clone https://github.com/<owner>/<repo>
   /opt/kitchen-care`. Private repo: create a read-only deploy key (Settings > Deploy keys),
   keep the private half in `/root/.ssh`, and clone over SSH.
2. `cd /opt/kitchen-care && cp deploy/.env.example .env && chmod 600 .env`, then fill it in:
   `DOMAIN`, `ORIGIN` (`https://<DOMAIN>`), `POSTGRES_PASSWORD`, `SESSION_SECRET`
   (`openssl rand -hex 32` for both), `APP_TIMEZONE=Europe/Zurich`, `NPM_NETWORK=proxy-net`.
   Find NPM's network with `docker network ls`. The trusted proxy subnet is auto-detected from it
   (`NPM_SUBNET` overrides; a mismatch warns). Trust is by network, so attach only your own apps
   to it; only the proxy joins it, the app colours stay on the private network.
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

The admin **System** page (Admin > System) complements Uptime Kuma: Kuma tells you the app is up,
System tells you whether it is healthy (disk, photos, database, container and host memory, load)
and which commit is deployed (`GIT_SHA` build arg, passed by `update.sh`). It is read-only and
cannot see backups. Its Attention / Critical thresholds are constants in
`src/lib/server/system/thresholds.ts`.

## Registering the runner

The deploy job runs on a repo-scoped, **ephemeral** self-hosted runner that lives in a container
on the VPS and drives the host's Docker through the mounted socket (docker-outside-of-docker).

1. `mkdir /opt/kitchen-care-runner && cp deploy/runner/docker-compose.yml.example
   /opt/kitchen-care-runner/docker-compose.yml`, copy `deploy/runner/.env.example` to `.env`
   there (`chmod 600`).
2. Edit the compose file: `REPO_URL`, and `<docker-gid>` from `getent group docker`. The deploy
   directory is mounted at the **same absolute path** inside the container, because compose sends
   host paths (`./deploy/nginx`, `./state`) to the host daemon. `GIT_CONFIG_*` sets
   `safe.directory=/opt/kitchen-care` (git refuses a clone owned by another user otherwise); if
   the clone lives elsewhere, change it and the mount together with the `DEPLOY_DIR` variable. The
   `./ssh` mount (only the deploy key) is optional, for a private repo over SSH.
3. Put a token in `.env`: `ACCESS_TOKEN` (fine-grained PAT, see Trust model) or, for a first
   test, a one-hour `RUNNER_TOKEN` (Settings > Actions > Runners > New self-hosted runner).
4. An ephemeral runner takes one job and exits, so it must be recreated to register again.
   systemd is the only supervisor (the compose file says `restart: "no"` on purpose);
   `--force-recreate` gives every job a fresh container and registration
   (`/etc/systemd/system/kitchen-care-runner.service`):
   ```ini
   [Unit]
   Description=Kitchen Care GitHub Actions runner
   Requires=docker.service
   After=docker.service
   [Service]
   WorkingDirectory=/opt/kitchen-care-runner
   ExecStart=/usr/bin/docker compose up --force-recreate --abort-on-container-exit
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
| `DOMAIN` | optional; if set, the job finishes by polling `https://<DOMAIN>/healthz` from the runner and checking for `"ok":true` (the VPS may not reach its own public address, "hairpin NAT"; leave `DOMAIN` unset then and rely on Uptime Kuma) |

Create the `production` environment and add required reviewers to it.

## Routine deploys

- **Push to `main`**: CI, then the deploy job. A newer push queues behind a running deploy;
  deploys are never cancelled mid-flight.
- **From GitHub**: Actions > Deploy > Run workflow (`workflow_dispatch`).
- **On the VPS**: `deploy/update.sh`; `FORCE=1` redeploys the commit already live (otherwise
  "already deployed"). `--help` lists the exit codes; the log is `state/update.log`.

Steps: refuse unless `.env` is complete, the clone is on `main` and `.env` is untracked; take the
lock; `git fetch`, then `git reset --hard` to `DEPLOY_SHA` (the commit CI tested; it must be on
`origin/main`, and it is skipped with exit 0 if the deployed commit already contains it, so an
older queued run never rolls back a newer deploy) or, in a manual run, to `origin/main`. Only
tracked files change (`.env`, `state/`, volumes are untouched); the script re-executes itself after
the reset. Then: stop if that commit is already live; refuse if `MemAvailable` is below
`MIN_BUILD_FREE_MB`; build `kitchen-care-app:<sha>`; migrate with the new image (failure aborts);
start the other colour and wait for Docker `healthy` (`HEALTH_TIMEOUT`, 120 s); switch the upstream
and reload nginx; after `DRAIN_SECONDS` (10) stop the old colour. INT/TERM abort cleanly, the
previous `deploy/nginx` files are restored on any abort before the switch, and any failure leaves
the old colour serving.

Locking: one update/deploy/rollback at a time, via `flock` on `state/.lock`; it holds between the
runner container and a manual run on the host and disappears with its holder. A second run exits 75.

Resources: the build runs on the VPS, roughly 1-2 minutes of CPU. Bounded: the Node heap of the
Vite build (`NODE_BUILD_MEMORY_MB`, 768) and a start guard (`MIN_BUILD_FREE_MB`, 900 MB available).
**Not** bounded: CPU priority (BuildKit runs inside the Docker daemon) and native memory from
`npm ci`, esbuild or sharp, so expect a CPU spike. A dedicated `docker buildx` builder with
`--driver-opt` limits is a possible future measure. Runtime: app 384 MB, postgres 192 MB, proxy
32 MB, runner 1 GB; `MIN_FREE_MB` (400) guards the second colour. Tunables: `.env.example`.

The sign-up welcome bonus ends at `WELCOME_BONUS_UNTIL` (ISO-8601 with an offset or `Z`; default
`2026-11-20T00:00:00+01:00`). Leave it unset to use the default; a time in the past switches the
bonus off. Change it in `.env` and redeploy.

## Rollback

`deploy/rollback.sh` restarts the previous colour (kept stopped), checks it is healthy and switches
back. Migrations are not reverted, so keep them backward compatible with the previous release. To
go further back, deploy one of the three newest kept tags with `deploy/deploy.sh <tag>`.

The release that makes coffee grounds a reviewed photo chore and adds the admin "Activity" page
ships two migrations, applied by the next deploy: one changes the `grounds` task row (photo and
review required) and one adds the `revoked` submission status with its audit columns. Both are
additive, and rolling back to the previous colour keeps points correct: the older code only sums
`approved` rows, so removed chores stay out of every total. What the older code does not know:
a removed chore shows to its owner as "Rejected" instead of "Removed by admin", it still counts
for the cooldown of that chore (the person cannot log it again until it runs out), and grounds
photos have no once-a-day limit there. Removed chores are kept, not deleted, so rolling forward
again restores the right behaviour.

## Backups and restore

`deploy/backup.sh` writes `kitchen-<stamp>.dump` (pg_dump custom format) to `BACKUP_DIR` (default
`/var/backups/kitchen-care`), keeps 14, exits non-zero on failure, and on Sundays (or
`BACKUP_UPLOADS=1`) also tars the uploads volume (keeps 5). Nightly via cron:

```
# /etc/cron.d/kitchen-care-backup
15 3 * * * root cd /opt/kitchen-care && ./deploy/backup.sh >>/var/log/kitchen-care-backup.log 2>&1
```

Copy dumps off the VPS yourself. Restore: stop both colours first, so nothing writes meanwhile.

```sh
cd /opt/kitchen-care && export COMPOSE_PROFILES=apps,tools
docker compose stop kitchen-care-app-blue kitchen-care-app-green     # the site shows 502 meanwhile
docker compose exec -T postgres pg_restore -U kitchen -d kitchen --clean --if-exists \
  < /var/backups/kitchen-care/kitchen-<stamp>.dump
docker compose start kitchen-care-app-$(cat state/active)
# uploads (colour running): docker compose exec -T kitchen-care-app-$(cat state/active) \
#   tar -xzf - -C /data < /var/backups/kitchen-care/uploads-<stamp>.tar.gz
```

## Trust model

**Anyone with write access to the repository can run code as root on the VPS** through this runner
(it has the Docker socket and the deploy directory): a pushed branch can add a workflow that
targets the `kitchen-care` runner label, and branch protection on `main` and reviewers on the
`production` environment do **not** apply to that. Give write access only to people you would give
root. `deploy.yml` itself runs only on `push` and `workflow_dispatch`, never `pull_request`, and CI
for pull requests uses GitHub-hosted runners only.

- Keep the repository **private** (recommended). If public, set Settings > Actions > General >
  "Fork pull request workflows" to require approval for all outside collaborators (a fork's
  workflow files could retarget the runner label).
- The runner's `ACCESS_TOKEN` sits in the container environment and every job can read it. Use a
  fine-grained PAT limited to this one repository with only the permission the runner image needs
  (Administration read/write), with an expiry, and rotate it.
- Use the runner for this repository only. Still protect `main` and add reviewers to `production`:
  they gate the normal path, and the job passes `DEPLOY_SHA` so only the CI-tested commit deploys.

## Notes and checklist

- Cutlery detection loads the COCO-SSD model from `https://storage.googleapis.com` in the user's
  browser (allowed by the app's CSP), so clients need that outbound access.
- Orphans: earlier versions used generic service names (`app-blue`, `app-green`). `deploy.sh` warns
  about containers of a removed service; remove them with
  `docker compose up -d --remove-orphans postgres kitchen-care-proxy` (name the services, or the
  colours would start) or `docker rm -f <container>`.
- Security: firewall allows only 22/80/443; SSH key auth only; never publish Postgres (it has no
  `ports`); `.env` and the runner `.env` mode 600; consider `fail2ban`.
- Local try-out: `deploy/local/compose.local.yml` (project `kitchen-care-local`, an `npm-sim`
  container stands in for NPM on `127.0.0.1:8080`; its header explains the `.env`). Tear down only
  that project, always with `-p`: `docker compose -p kitchen-care-local --profile '*' down -v`.
  **`-v` deletes the volumes (database and photos); never run it in the production directory**
  (to stop production use `docker compose stop`).
