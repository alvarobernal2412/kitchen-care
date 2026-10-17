# Kitchen Care Credits

Good karma pays out: rack up your credits for this semester's grand reward.

A small web app for a shared office kitchen. People log chores (dishwasher, coffee grounds,
cutlery, restocking, descaling...) to earn credits, admins approve the photo-backed ones (beans,
milk, coffee grounds, descaling, deep clean), and a
leaderboard decides the semester prize. SvelteKit 2, Drizzle, Postgres, sharp.

## Setup

```sh
npm install
cp .env.example .env              # DATABASE_URL, SESSION_SECRET, UPLOAD_DIR, ...
docker compose -f compose.dev.yml up -d   # Postgres on localhost:5432
npm run db:push                   # create the schema in the dev database
npm run dev
```

## Welcome bonus

An account created through sign-up before 20 November 2026 (00:00 Europe/Zurich) gets a one-time
bonus of 10 credits, but only if a period is active at that moment. It counts like any approved
credit and shows as "Welcome bonus" in the user's own submissions only. Existing accounts never
get it. `WELCOME_BONUS_UNTIL` (ISO-8601 with offset, see `.env.example`) moves or disables the cutoff.

## Coffee grounds and removing points

Taking the coffee grounds to the 2nd basement is a reviewed photo chore: a live camera photo, approved
by an admin (+3), at most once per 24 hours (a pending or approved photo starts the wait; a rejected
or removed one does not). The dishwasher stays self-reported. Admins can undo a wrong check in
**Admin > Activity**: it lists the approved chores of the running period (filter by person or chore)
and each has "Remove points" with a required reason and a confirmation. The chore then counts
nowhere, its owner sees "Removed by admin: <reason>" and can log it again; a milestone's feed post
is deleted. Periods that have ended are final and cannot be changed.

## Try it locally

Needs Node 24 and Docker. The demo data is for local development only: the seed refuses to run
unless `DATABASE_URL` points at localhost, 127.0.0.1 or ::1 and `NODE_ENV` is not `production`.

```sh
docker compose -f compose.dev.yml up -d   # Postgres on localhost:5432
cp .env.example .env                      # set SESSION_SECRET to any long random string; the rest works as is
npm ci
npm run dev:seed                          # applies the migrations, then adds the demo data
npm run dev                               # http://localhost:5173
```

Sign in as `admin` / `Admin-Dev-2026!` or as the member `demo` / `Kitchen-Dev-2026!` (47 points,
rank 3). The other members (`lena`, `mateo`, `priya`, `jonas`, ...) share the member password.
`npm run dev:seed` twice changes nothing; `npm run dev:seed -- --reset` empties the app tables of
that local database, removes the uploads it wrote and creates the demo data again.

Things to try:

1. Log the dishwasher and watch the credit count-up.
2. See the cooldown fill on the chore tiles (as `demo`, three are partly through their cooldown,
   one of them the approved coffee grounds photo).
3. Submit a photo task (beans, milk, coffee grounds) with the camera or a file.
4. Run the cutlery check.
5. As admin, approve the descaling in Review and find the milestone post in the feed; remove a
   chore's points in Activity and look at the member's Home.
6. Use the leaderboard filters (Students, Employees, department); first place is a tie.
7. Collapse the sidebar at laptop width.
8. Install the app as a PWA (production build: `npm run build && npm run preview`).
9. Switch your OS to dark mode.
10. Tick "Offline" in the browser DevTools network tab and reload to see the offline page.

### On a phone

The camera needs a secure context, so `http://<LAN-IP>:5173` will not offer it on a phone, and
`npm run build && npm run preview -- --host` over the LAN is plain http too. Use an https tunnel
to the dev server instead (Cloudflare quick tunnel; the dev server already accepts
`*.trycloudflare.com` hosts):

```sh
npm run dev
cloudflared tunnel --url http://localhost:5173   # prints https://<random>.trycloudflare.com
```

Open that URL on the phone. No `ORIGIN` setting is needed in dev: the API's same-origin check
trusts `X-Forwarded-Proto` there (the tunnel sends it), and SvelteKit's own check is off in dev.

## Tests

```sh
npm test            # unit tests (vitest); each file gets a throwaway database
npm run lint
npm run check       # svelte-check
```

### End-to-end (Playwright, real Chromium)

```sh
npx playwright install chromium   # once; downloads to your user cache
npm run test:e2e
```

The run builds the production app (`npm run build && node build`) on port 4179 against a
dedicated `kitchen_e2e` database. `tests/e2e/global-setup.ts` drops and recreates that database
on the Postgres from `DATABASE_URL` (defaults to the compose.dev.yml one), applies the
migrations, seeds the tasks, creates an admin and an active period. It never touches the dev or
unit-test databases. Uploads go to a temp directory. Tests use unique usernames, so they need
no cleanup. Locally an already-running server on that port is reused; set `CI=1` to always
start a fresh one.

## Design system

- Tokens (colour, type, spacing, radii, motion; light and dark): `src/lib/styles/tokens.css`.
  Reset and typography: `base.css`. Shared classes (`.btn`, `.chip`, `.tile`, `.rows`, ...):
  `components.css`. Components use tokens only: no hard-coded colours, mobile-first, no
  `max-width` media queries. Reference mockups and notes: `docs/design/mockups/`.
- Accessibility and layout checks (axe on every key page, phone and laptop, light and dark;
  no horizontal scroll; keyboard order; reduced motion; focus rings): `npx playwright test a11y.spec.ts`
  runs a representative subset (about 2 minutes). The full matrix, every page in both schemes at
  both viewports plus a 360 px layout check (about 6 minutes): `npm run test:a11y:full`.
- Screenshots of every screen (390 and 1280 px, light and dark) from seeded data:
  `node scripts/screenshots.mjs [output-dir]` (default `tmp/screenshots`, git-ignored). It
  uses the same dedicated e2e database as the e2e suite.

## Install as an app (PWA)

The service worker and manifest are active in production builds. On Android Chrome use
"Install app"; on iOS Safari use Share, then "Add to Home Screen". Icons are regenerated with
`node scripts/generate-icons.mjs`.

## Deployment

Production runs as a Docker stack behind an existing Nginx Proxy Manager on a VPS, deployed by
a self-hosted GitHub Actions runner on the VPS on push to `main` (`deploy/update.sh` pulls, builds
and does a blue/green switch). Set the repository variable `DEPLOY_ENABLED=true` to turn the deploy
job on; until then it is skipped. See `deploy/README.md` for the runbook.
