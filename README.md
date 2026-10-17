# Kitchen Care Credits

Good karma pays out: rack up your credits for this semester's grand reward.

A small web app for a shared office kitchen. People log chores (dishwasher, coffee grounds,
cutlery, restocking, descaling...) to earn credits, admins approve the photo-backed ones, and a
leaderboard decides the semester prize. SvelteKit 2, Drizzle, Postgres, sharp.

## Setup

```sh
npm install
cp .env.example .env              # DATABASE_URL, SESSION_SECRET, UPLOAD_DIR, ...
docker compose -f compose.dev.yml up -d   # Postgres on localhost:5432
npm run db:push                   # create the schema in the dev database
npm run dev
```

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
- Accessibility and layout checks (axe on every key page, light and dark, phone and laptop;
  no horizontal scroll; keyboard order; reduced motion; focus rings): `npx playwright test a11y.spec.ts`.
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
