# Deploying Kitchen Care Credits

Target: a small shared VPS that already runs Nginx Proxy Manager (NPM, owns 80/443, DNS-facing TLS)
and Uptime Kuma on a shared Docker network (`proxy-net` by default). This stack publishes **no host
ports** and does no TLS. Images are built by GitHub Actions, never on the VPS (it has little RAM).

```
browser -> NPM (TLS) -> kitchen-care-proxy:80 -> kitchen-care-app-blue | -green -> kitchen-care postgres
                        (internal nginx: rate limits, gzip, blue/green switch, real client IP)
```

All containers, volumes and networks are named `kitchen-care-*`. Postgres is our own private
container with its own volume on a private network; no existing database on the VPS is touched.

## One-time setup on the VPS

1. Pick `<DEPLOY_PATH>` (default `/opt/kitchen-care`) and copy this repo's `deploy/` folder there
   by hand once: `scp -r deploy <user>@<VPS_HOST>:<DEPLOY_PATH>/` (CI keeps it updated afterwards).
2. `cd <DEPLOY_PATH> && cp deploy/.env.example .env && chmod 600 .env`, then fill in `.env`:
   `DOMAIN`, `ORIGIN` (`https://<DOMAIN>`), `POSTGRES_PASSWORD`, `SESSION_SECRET`
   (`openssl rand -hex 32` for both), `APP_TIMEZONE` (`Europe/Zurich` for Bern), `NPM_NETWORK`.
   `deploy.sh` refuses to run if a required variable is missing.
3. Confirm NPM's network: `docker network ls`, and
   `docker inspect <npm container> --format '{{json .NetworkSettings.Networks}}'`. Put that name in
   `NPM_NETWORK` (`proxy-net`). The trusted subnet is auto-detected from that network (override
   with `NPM_SUBNET` only if needed; `deploy.sh` warns when it does not match).
   Every container on that network can set the client IP our proxy trusts: the trust is by
   network, not identity, so only attach your own apps to it. Only the proxy joins that network;
   the app colours are the services `kitchen-care-app-blue` and `kitchen-care-app-green` on our
   private network only, so no generic name like `app-blue` exists anywhere.
4. Create a dedicated CI key (`ssh-keygen -t ed25519 -f kitchen-care-ci`) and add to
   `~/.ssh/authorized_keys` of the deploy user (root on this VPS, as docker is needed):
   ```
   restrict,command="<DEPLOY_PATH>/deploy/remote-deploy.sh",no-pty ssh-ed25519 AAAA... kitchen-care-ci
   ```
   `chmod +x <DEPLOY_PATH>/deploy/*.sh`. **Blast radius, plainly:** the forced command limits what
   the key can *invoke*, not what gets *run*. CI ships the compose file and the `deploy/` scripts with
   every image, so whoever holds this key, can push to `main`, or can edit the workflow can run
   arbitrary code as root on the VPS. The script does reject path traversal, links, oversize streams,
   bad tags and any image archive that would re-tag something other than `kitchen-care-app:<tag>`,
   but that is hardening, not a sandbox. Therefore: protect the GitHub repository, enable branch
   protection on `main`, put required reviewers on the `production` environment, use this dedicated
   key for nothing else, and keep the secrets in that environment only.
5. In **NPM**, add a Proxy Host: domain `<DOMAIN>`, scheme `http`, Forward Hostname
   `kitchen-care-proxy`, Forward Port `80`, Block Common Exploits **on**, Websockets off. SSL tab:
   request a certificate, **Force SSL** on. Advanced tab: add `client_max_body_size 6m;`
   (NPM's default is 1 MB and would block photo uploads).
6. In **Uptime Kuma**, add an HTTP(s) monitor: `https://<DOMAIN>/healthz`, interval 60 s, expect
   status 200 and keyword `"ok":true`. Optionally add a second one from inside the network:
   `http://kitchen-care-proxy/healthz`.
7. Add the GitHub secrets (below) and push to `main`. The first deploy creates the colours,
   runs migrations and starts the proxy.
8. Create the first admin (password is read from env, never argv, never logged):
   ```sh
   cd <DEPLOY_PATH>
   read -rs ADMIN_BOOTSTRAP_PASSWORD && export ADMIN_BOOTSTRAP_PASSWORD
   ADMIN_BOOTSTRAP_USERNAME=admin docker compose run --rm \
     -e ADMIN_BOOTSTRAP_USERNAME -e ADMIN_BOOTSTRAP_PASSWORD migrate node scripts/bootstrap-admin.js
   ```
   Idempotent; the password must satisfy the signup policy (8+ chars, upper, lower, digit, symbol).

## GitHub secrets and variables (environment `production`)

| Name | Kind | Meaning |
| --- | --- | --- |
| `DEPLOY_HOST` | secret | VPS hostname or IP |
| `DEPLOY_USER` | secret (optional) | SSH user, default `root` |
| `DEPLOY_SSH_KEY` | secret | private half of the CI key from step 4 |
| `DEPLOY_KNOWN_HOSTS` | secret | output of `ssh-keyscan -t ed25519 <VPS_HOST>` (verify the fingerprint) |
| `DOMAIN` | variable or secret | public domain, used for the post-deploy `/healthz` check |

Until these exist the deploy job skips with a notice instead of failing. `DEPLOY_PATH` is not needed
by CI: the forced command knows its own location.

## Routine deploys

Push to `main`. Workflow: CI jobs, then build on the runner, stream `image.tar.gz` + `compose.yml`
+ `deploy/` over one SSH connection. `remote-deploy.sh` caps the stream size (`MAX_STREAM_MB`),
checks free disk, validates the tar entries and the tag, verifies that the image archive only carries
`kitchen-care-app:<tag>`, loads it and runs `deploy.sh <tag>`. A held lock (pid inside) blocks a
second deploy; a lock whose process is gone is recovered. Output is also written to
`state/deploy.log`, and a dropped SSH session does not stop a deploy in progress. SIGTERM/SIGINT
abort cleanly (old colour keeps serving). The steps:

1. refuse if less than `MIN_FREE_MB` (default 400) of memory is available;
2. run migrations and task seeding with the new image (failure aborts, old colour keeps serving);
3. start the inactive colour, wait for Docker `healthy` (timeout `HEALTH_TIMEOUT`, 120 s);
4. rewrite `state/upstream.conf`, `nginx -t`, reload (graceful, no dropped requests);
5. after `DRAIN_SECONDS` (10) stop the old colour. Two app containers run only during this window.

CI then polls `https://<DOMAIN>/healthz` for ~60 s.

## Rollback

`<DEPLOY_PATH>/deploy/rollback.sh` restarts the previous colour (kept stopped, image intact), checks
it is healthy and switches back. Migrations are not reverted, so keep them backward compatible with
the previous release (add first, remove a release later). To go further back, deploy an older tag.

## Backups and restore

`deploy/backup.sh` writes `kitchen-<stamp>.dump` (pg_dump custom format, compressed) to
`BACKUP_DIR` (default `/var/backups/kitchen-care`), keeps 14, exits non-zero on failure, and on
Sundays (or `BACKUP_UPLOADS=1`) also tars the uploads volume (keeps 5). Schedule it nightly:

```
# /etc/cron.d/kitchen-care-backup
15 3 * * * root cd <DEPLOY_PATH> && ./deploy/backup.sh >>/var/log/kitchen-care-backup.log 2>&1
```

Copying dumps off the VPS is up to you. Restore: stop the app colours first, so nothing writes
while `--clean` drops and recreates the objects, then start the active colour again.

```sh
cd <DEPLOY_PATH>
export COMPOSE_PROFILES=apps,tools
docker compose stop kitchen-care-app-blue kitchen-care-app-green          # the site shows 502 until step 3
docker compose exec -T postgres pg_restore -U kitchen -d kitchen --clean --if-exists \
  < /var/backups/kitchen-care/kitchen-<stamp>.dump
docker compose start kitchen-care-app-$(cat state/active)    # blue or green
# uploads (with the colour running): docker compose exec -T kitchen-care-app-$(cat state/active) \
#   tar -xzf - -C /data < uploads-<stamp>.tar.gz
```

## Notes

- `APP_TIMEZONE` buckets the analytics by day/hour. It defaults to UTC in code; set your office zone (`Europe/Zurich` for Bern).
- Cutlery detection loads the COCO-SSD model from `https://storage.googleapis.com` in the user's
  browser (allowed by the app's CSP), so clients need outbound access to that host.
- Photos are served by the app at `/media/*` (authenticated); the uploads volume is never exposed.
- Memory: app 384 MB, postgres 192 MB, proxy 32 MB. Logs rotate (10 MB x 3 per container).
- Security: firewall allows only 22/80/443, SSH key auth only, consider `fail2ban`, never publish
  Postgres, keep `.env` at mode 600.

## Try it locally (no TLS, no VPS)

```sh
docker network create npm-sim
# .env: COMPOSE_PROJECT_NAME=kitchen-care-local, COMPOSE_PATH_SEPARATOR=:,
#       COMPOSE_FILE=compose.yml:deploy/local/compose.local.yml, NPM_NETWORK=npm-sim,
#       DOMAIN=kitchen.local, ORIGIN=https://kitchen.local (+ the other required variables)
docker build -t kitchen-care-app:local . && sh deploy/deploy.sh local
docker compose --profile sim up -d npm-sim     # NPM stand-in on http://127.0.0.1:8080
docker compose -p kitchen-care-local down -v    # tear everything down
```
