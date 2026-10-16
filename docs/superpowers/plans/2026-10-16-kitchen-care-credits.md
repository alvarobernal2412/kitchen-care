# Kitchen Care Credits Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Kitchen Care Credits PWA: chore logging with credits, admin review, leaderboard per period, community feed, admin tooling, deployed to a single Dockerized VPS.

**Architecture:** One SvelteKit app (Node adapter) serves UI and API. Domain logic lives in `src/lib/server/` as plain functions taking a `db` handle, so it is unit-testable against a real Postgres. Postgres via Drizzle. Proof images on a Docker volume served by Nginx. Cutlery detection runs in the browser only.

**Tech Stack:** SvelteKit, TypeScript, PostgreSQL, Drizzle ORM, argon2, zod, sharp, TensorFlow.js COCO-SSD, `@vite-pwa/sveltekit`, Vitest, Playwright, Nginx, Docker Compose, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-10-16-kitchen-care-credits-design.md`

## Global Constraints

- Log a chore in ≤ 3 taps on mobile; mobile-first, installable PWA with offline-capable shell.
- Password policy: ≥ 8 chars, ≥ 1 upper, ≥ 1 lower, ≥ 1 digit, ≥ 1 symbol; hashed with argon2id.
- Classification `Student` | `Employee`; employees must pick a department: `Software Systems Programming and Development` or `Interactions Research Group`.
- Sessions: long-lived HTTP-only secure cookie; deactivated users cannot log in.
- Reset tokens: 32 random bytes, 1-hour expiry, single use, stored hashed, admin-generated only.
- Task points: cutlery 1, dishwasher 2, coffee grounds 3, beans 5, milk 3, descale 10, deep clean 15.
- Cooldowns: dishwasher 2 h 30 min, coffee grounds 24 h, cutlery 30 min; admin-reviewed tasks none.
- Cutlery photos are never persisted. Persisted images: WebP, max 1080 px, quality 0.8, target < 250 KB; server re-encodes and strips EXIF.
- Reactions: 👏 ❤️ ☕ 🎉 🙌, one of each per user per post.
- Exactly one active period at a time; ending a period locks the leaderboard and records winner(s).
- Image deletion is admin-triggered by a button, behind a confirmation; credits are unaffected.
- Rate limits on auth and task endpoints; strict CSP, CSRF protection, zod validation on every endpoint, sanitised user text.
- Commit messages: one short imperative line, atomic, no AI co-author trailers. Never run `git commit` without the user having approved the message. Never commit `CLAUDE.md`.
- Work in a git worktree, not on `main`; merge by rebase + fast-forward.

## Review Focus

- Two simultaneous requests logging the same cooldown task: only one credits (race on cooldown check).
- User approved after the period ended, or submitting while no active period exists: must not credit a closed period; defined error when no period is active.
- Admin approves/rejects the same pending submission twice: points credited once.
- Username case/whitespace variants (`Ana` vs `ana `): treated as the same account.
- Reset token reused, expired, or used after the user was deactivated: rejected.

---

### Task 1: Project skeleton and tooling

**Files:**
- Create: SvelteKit TypeScript project at repo root (`package.json`, `svelte.config.js`, `vite.config.ts`, `tsconfig.json`), `eslint.config.js`, `compose.dev.yml` (Postgres), `drizzle.config.ts`, `.env.example`, `.gitignore`, `src/routes/healthz/+server.ts`
- Test: `tests/unit/healthz.test.ts`

**Interfaces:**
- Produces: `GET /healthz` → `200 {"ok":true}`; npm scripts `dev`, `build`, `lint`, `test`, `test:e2e`, `db:push`.

- [ ] **Step 1:** Write `healthz.test.ts` asserting the handler returns status 200 and body `{ ok: true }`.
- [ ] **Step 2:** Run `npx vitest run tests/unit/healthz.test.ts`; expect FAIL (module missing).
- [ ] **Step 3:** Scaffold the project with `adapter-node`, Vitest, ESLint, Playwright; implement the `/healthz` handler; add `compose.dev.yml` with Postgres 16 and a `.env.example` with `DATABASE_URL`, `SESSION_SECRET`, `ADMIN_BOOTSTRAP_USERNAME`, `UPLOAD_DIR`.
- [ ] **Step 4:** Run `npm run lint && npm test`; expect PASS.
- [ ] **Step 5:** Commit: `chore: scaffold SvelteKit project`.

### Task 2: Database schema and seed

**Files:**
- Create: `src/lib/server/db/schema.ts`, `src/lib/server/db/index.ts`, `src/lib/server/db/seed.ts`, `tests/helpers/testDb.ts`
- Test: `tests/unit/seed.test.ts`

**Interfaces:**
- Produces tables: `users(id, username_normalized, display_username, password_hash, role, classification, department, avatar_path, active, onboarding_completed, created_at)`, `sessions`, `reset_tokens(token_hash, user_id, expires_at, used_at)`, `periods(id, name, starts_at, ends_at, status)`, `period_winners`, `tasks(key, label, points, cooldown_seconds, requires_photo, persist_photo, needs_review, milestone)`, `submissions(id, user_id, task_key, period_id, status, points_awarded, image_path, reject_reason, created_at, reviewed_at, reviewed_by)`, `posts`, `comments`, `reactions(post_id, user_id, emoji)`, `events(id, user_id, type, created_at)`.
- Produces: `seedTasks(db): Promise<void>` (idempotent), `getTestDb(): Promise<Db>` (fresh schema per test file), `bootstrapAdmin(db, username, password): Promise<void>`.

- [ ] **Step 1:** Write `seed.test.ts`: after `seedTasks` twice, `tasks` has exactly 7 rows; `descale.points === 10`; `dishwasher.cooldown_seconds === 9000`; `cutlery.persist_photo === false`; `beans.needs_review === true`.
- [ ] **Step 2:** Run the test; expect FAIL.
- [ ] **Step 3:** Implement schema (unique index on `username_normalized`, unique `(post_id,user_id,emoji)` on reactions, partial unique index allowing one `active` period) and the seed with the values in Global Constraints.
- [ ] **Step 4:** Run the test; expect PASS.
- [ ] **Step 5:** Commit: `feat(db): add schema and task seed`.

### Task 3: Auth, sessions, roles

**Files:**
- Create: `src/lib/server/auth/password.ts`, `src/lib/server/auth/session.ts`, `src/lib/server/auth/users.ts`, `src/hooks.server.ts`, routes `src/routes/(auth)/{signup,login}/`, `src/routes/logout/+server.ts`, `src/lib/components/PasswordMeter.svelte`
- Test: `tests/unit/password.test.ts`, `tests/unit/auth.test.ts`

**Interfaces:**
- Produces: `validatePassword(pw: string): { ok: boolean; missing: ('length'|'upper'|'lower'|'digit'|'symbol')[] }`, `normalizeUsername(s: string): string` (trim + lowercase), `signUp(db, input: SignUpInput): Promise<User>`, `login(db, username, password): Promise<{ sessionId: string }>`, `getSessionUser(db, sessionId): Promise<User | null>`, `requireAdmin(locals): User`.

- [ ] **Step 1:** Write tests: `validatePassword('Abcdef1!')` ok; `'abcdefg1!'` missing `upper`; `'Ab1!'` missing `length`. `signUp` rejects `Employee` without department; rejects duplicate of `'Ana'` when `'ana '` exists; login fails for deactivated user and wrong password; `getSessionUser` returns null after logout.
- [ ] **Step 2:** Run; expect FAIL.
- [ ] **Step 3:** Implement with argon2id and opaque random session ids stored hashed; `hooks.server.ts` loads the user, sets CSP/security headers, enforces same-origin CSRF check on mutating requests; in-app rate limiter (`src/lib/server/ratelimit.ts`: `hit(key, limit, windowMs): boolean`) on login/signup.
- [ ] **Step 4:** Run; expect PASS.
- [ ] **Step 5:** Commit: `feat(auth): add signup, login and sessions`.

### Task 4: Admin-assisted password reset

**Files:**
- Create: `src/lib/server/auth/reset.ts`, `src/routes/reset-password/`
- Test: `tests/unit/reset.test.ts`

**Interfaces:**
- Consumes: `users` and `reset_tokens` tables (Task 2).
- Produces: `createResetToken(db, adminId, userId, now?: Date): Promise<string>` (returns raw token), `consumeResetToken(db, token, newPassword, now?: Date): Promise<void>`.

- [ ] **Step 1:** Write tests: token works once; second use throws; use at `now + 61 min` throws; deactivated user's token throws; weak new password throws and does not consume the token; all of the user's sessions are revoked after a reset.
- [ ] **Step 2:** Run; expect FAIL.
- [ ] **Step 3:** Implement with `crypto.randomBytes(32).toString('hex')`, store SHA-256 of the token.
- [ ] **Step 4:** Run; expect PASS.
- [ ] **Step 5:** Commit: `feat(auth): add admin password reset links`.

### Task 5: Periods and task logging (auto-approved)

**Files:**
- Create: `src/lib/server/periods.ts`, `src/lib/server/tasks.ts`, `src/routes/api/tasks/[key]/+server.ts`, `src/routes/(app)/+page.svelte` (home with task buttons)
- Test: `tests/unit/periods.test.ts`, `tests/unit/tasks.test.ts`

**Interfaces:**
- Produces: `createPeriod(db, name): Promise<Period>` (fails if one is active), `getActivePeriod(db): Promise<Period | null>`, `logTask(db, userId, taskKey, opts?: { now?: Date; imagePath?: string }): Promise<Submission>`; errors `NoActivePeriodError`, `CooldownError { retryAfterSeconds: number }`.

- [ ] **Step 1:** Write tests: dishwasher logged → 2 points credited immediately; second log after 2 h 29 min throws `CooldownError` with `retryAfterSeconds` = 60; log at 2 h 30 min succeeds; grounds twice in 23 h fails; with no active period throws `NoActivePeriodError`; `Promise.all` of two simultaneous dishwasher logs yields exactly one success.
- [ ] **Step 2:** Run; expect FAIL.
- [ ] **Step 3:** Implement inside a transaction using a per-(user,task) advisory lock for the cooldown check; photo-requiring tasks are rejected here unless routed through Task 8's submission path. Home page shows a button per self-reported task with the cooldown message from `CooldownError`.
- [ ] **Step 4:** Run; expect PASS.
- [ ] **Step 5:** Commit: `feat(tasks): add period and cooldown-based task logging`.

### Task 6: Leaderboard, period lifecycle, history

**Files:**
- Create: `src/lib/server/leaderboard.ts`, `src/routes/(app)/leaderboard/`, `src/routes/(app)/history/`
- Modify: `src/lib/server/periods.ts`
- Test: `tests/unit/leaderboard.test.ts`

**Interfaces:**
- Produces: `getLeaderboard(db, periodId, filter?: { classification?: 'Student'|'Employee'; department?: string }): Promise<{ userId; username; avatar; points; rank }[]>` (ties share rank; only `approved` submissions count), `endPeriod(db, periodId): Promise<PeriodWinner[]>`, `listPastPeriods(db)`.

- [ ] **Step 1:** Write tests: pending and rejected points excluded; filter by department; tie gives both rank 1 and next rank 3; `endPeriod` records all tied top users as winners and sets status `ended`; ended period's leaderboard unchanged by later approvals (approval into an ended period throws).
- [ ] **Step 2:** Run; expect FAIL.
- [ ] **Step 3:** Implement SQL aggregate with window function `RANK()`; build the pages.
- [ ] **Step 4:** Run; expect PASS.
- [ ] **Step 5:** Commit: `feat(leaderboard): add ranking, filters and period end`.

### Task 7: Camera, image pipeline, cutlery detection

**Files:**
- Create: `src/lib/client/camera.ts`, `src/lib/client/compress.ts`, `src/lib/client/cutlery.ts`, `src/lib/components/CameraCapture.svelte`, `src/lib/server/images.ts`
- Test: `tests/unit/images.test.ts`, `tests/unit/cutlery.test.ts`

**Interfaces:**
- Produces: `compressToWebp(source: ImageBitmap | HTMLVideoElement): Promise<Blob>` (≤ 1080 px side, quality 0.8), `hasCutlery(predictions: { class: string; score: number }[]): boolean` (true for `fork`/`knife`/`spoon` with score ≥ 0.5), `detectCutlery(video: HTMLVideoElement): Promise<boolean>` (lazy-loads COCO-SSD), server `processUpload(buf: Buffer): Promise<{ file: string; bytes: number }>` (rejects non-images and > 5 MB input; re-encodes to WebP ≤ 1080 px; strips EXIF; writes into `UPLOAD_DIR`).

- [ ] **Step 1:** Write tests: `hasCutlery` true for `[{class:'fork',score:0.9}]`, false for `[{class:'cup',score:0.99}]` and for a low-score spoon; `processUpload` on a 4000×3000 JPEG with EXIF GPS returns a WebP with max side 1080 and no EXIF; on a text buffer throws.
- [ ] **Step 2:** Run; expect FAIL.
- [ ] **Step 3:** Implement; `CameraCapture.svelte` uses `getUserMedia({ video: { facingMode: 'environment' } })` full-screen with no file input, falling back to `<input capture="environment">` only when `getUserMedia` is unavailable.
- [ ] **Step 4:** Run; expect PASS.
- [ ] **Step 5:** Commit: `feat(images): add camera capture and image pipeline`.

### Task 8: Photo tasks, cutlery task, review queue, milestone posts

**Files:**
- Create: `src/lib/server/review.ts`, `src/routes/api/submissions/+server.ts`, `src/routes/(admin)/admin/review/`
- Modify: `src/lib/server/tasks.ts`
- Test: `tests/unit/review.test.ts`

**Interfaces:**
- Consumes: `logTask`, `processUpload`, feed `createPost` (Task 9; stubbed via an injected `onMilestone` callback until then).
- Produces: `submitPhotoTask(db, userId, taskKey, image: Buffer): Promise<Submission>` (status `pending`, no points), `submitCutleryTask(db, userId, clientPassed: boolean): Promise<Submission>` (no image stored), `approve(db, adminId, submissionId): Promise<void>`, `reject(db, adminId, submissionId, reason: string): Promise<void>`.

- [ ] **Step 1:** Write tests: beans submission is pending with 0 points, then `approve` credits 5; approving twice credits once; `reject` stores reason and credits nothing; approving `descale` calls `onMilestone` once with the submission; cutlery with `clientPassed=false` throws; cutlery stores no `image_path` and writes no file; approving after the period ended throws.
- [ ] **Step 2:** Run; expect FAIL.
- [ ] **Step 3:** Implement with row-level lock (`SELECT … FOR UPDATE`) on approve/reject; admin queue page with approve, reject, and canned reasons.
- [ ] **Step 4:** Run; expect PASS.
- [ ] **Step 5:** Commit: `feat(review): add photo tasks and admin review queue`.

### Task 9: Community feed

**Files:**
- Create: `src/lib/server/feed.ts`, `src/lib/server/sanitize.ts`, `src/routes/(app)/feed/`, `src/lib/components/{Post,Reactions,Comments}.svelte`
- Test: `tests/unit/feed.test.ts`

**Interfaces:**
- Produces: `createPost(db, authorId, input: { body: string; imagePath?: string; milestoneSubmissionId?: number }): Promise<Post>`, `listPosts(db, { before?: Date; limit: number })`, `toggleReaction(db, userId, postId, emoji: Emoji): Promise<{ counts: Record<Emoji, number> }>`, `addComment(db, userId, postId, body: string)`, `deleteOwnPost(db, userId, postId)`, `deleteOwnComment(db, userId, commentId)`, `sanitizeText(s: string): string`.

- [ ] **Step 1:** Write tests: toggling the same emoji twice returns count to 0; an emoji outside the five is rejected; deleting another user's post throws; `<script>` in a comment is neutralised; a milestone post is created exactly once per submission.
- [ ] **Step 2:** Run; expect FAIL.
- [ ] **Step 3:** Implement; wire `onMilestone` from Task 8 to `createPost`; optimistic UI in `Reactions.svelte`.
- [ ] **Step 4:** Run; expect PASS.
- [ ] **Step 5:** Commit: `feat(feed): add posts, reactions and comments`.

### Task 10: Admin tools (users, moderation, image explorer, image deletion, analytics)

**Files:**
- Create: `src/lib/server/admin.ts`, `src/lib/server/analytics.ts`, routes under `src/routes/(admin)/admin/{users,moderation,images,analytics}/`
- Test: `tests/unit/admin.test.ts`, `tests/unit/analytics.test.ts`

**Interfaces:**
- Produces: `searchUsers(db, q)`, `setRole(db, adminId, userId, role)`, `setActive(db, adminId, userId, active)` (deactivation revokes sessions; an admin cannot deactivate or demote themselves if they are the last admin), `deletePeriodImages(db, periodId): Promise<{ removed: number }>`, `getActivity(db, range)`, `getHeatmap(db, range): number[7][24]`, `getTopContributors(db, periodId)`, `getTaskDistribution(db, periodId)`.

- [ ] **Step 1:** Write tests: last admin cannot be demoted; deactivation kills sessions; `deletePeriodImages` removes files, nulls `image_path`, marks submissions "image removed", and leaves `points_awarded` and the leaderboard unchanged; `getHeatmap` places three submissions at Tue 10:xx in cell `[1][10]` with count 3.
- [ ] **Step 2:** Run; expect FAIL.
- [ ] **Step 3:** Implement; record `events` rows (`app_open`, `task_submitted`) from `hooks.server.ts`/task code; the delete-images button requires a confirmation dialog on the page.
- [ ] **Step 4:** Run; expect PASS.
- [ ] **Step 5:** Commit: `feat(admin): add user, moderation, image and analytics tools`.

### Task 11: Profile, onboarding, PWA

**Files:**
- Create: `src/routes/(app)/onboarding/`, `src/routes/(app)/profile/`, `src/lib/client/avatar.ts`, `static/manifest.webmanifest`, icons; Modify: `vite.config.ts`
- Test: `tests/e2e/onboarding.spec.ts`

**Interfaces:**
- Consumes: `compressToWebp` (Task 7).
- Produces: `completeOnboarding(db, userId)`; service worker caching the app shell.

- [ ] **Step 1:** Write the Playwright test: new user sees the 3-step carousel once; after finishing, reload goes straight to home; manifest is served and the page loads offline after first visit (shell only).
- [ ] **Step 2:** Run `npx playwright test onboarding`; expect FAIL.
- [ ] **Step 3:** Implement carousel (credits, karma levels, semester prize), `onboarding_completed` in localStorage and DB, avatar crop + compress, PWA config.
- [ ] **Step 4:** Run; expect PASS. Drive the app in a mobile viewport with a browser tool and confirm the ≤ 3-tap logging path.
- [ ] **Step 5:** Commit: `feat(pwa): add onboarding, profile and manifest`.

### Task 12: Deployment and CI

**Files:**
- Create: `Dockerfile` (multi-stage), `compose.yml` (app, postgres, nginx; `mem_limit: 512m` on app), `deploy/nginx.conf` (`limit_req_zone`, gzip, image caching, TLS), `.github/workflows/deploy.yml`, `deploy/backup.sh`
- Test: workflow run on a branch

- [ ] **Step 1:** Write the workflow: on push to `main` run lint, unit tests, Playwright, build image, push, SSH to VPS, `docker compose up -d` with health-checked swap (start new container, wait for `/healthz`, then remove old).
- [ ] **Step 2:** Run `docker build .` locally; expect success and `docker run` serving `/healthz`.
- [ ] **Step 3:** Add nightly `pg_dump` cron script writing to a path set by env var.
- [ ] **Step 4:** Push the branch and confirm the CI run succeeds; after deploy, hit the live `/healthz` and log in to verify.
- [ ] **Step 5:** Commit: `ci: add Docker build and deploy pipeline`.

---

## Self-review notes

- Spec coverage: auth/onboarding/profile (3, 11), reset (4), tasks/cooldowns (5, 8), photo rules (7), feed (9), leaderboard/periods (6), admin (8, 10), security (3, 12), CI/CD (12). Bootstrap admin is in Task 2.
- Open call for the builder: backup target (Task 12), chart library (Task 10).
