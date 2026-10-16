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

## Install as an app (PWA)

The service worker and manifest are active in production builds. On Android Chrome use
"Install app"; on iOS Safari use Share, then "Add to Home Screen". Icons are regenerated with
`node scripts/generate-icons.mjs`.
