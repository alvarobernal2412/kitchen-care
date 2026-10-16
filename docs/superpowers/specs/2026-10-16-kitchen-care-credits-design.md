# Kitchen Care Credits — Design

## Intent

Office kitchen chores (loading the dishwasher, taking out coffee grounds, restocking coffee and milk, descaling the machine, deep cleaning) go undone because nobody is rewarded for them. Kitchen Care Credits is a mobile-first PWA where people log chores, earn credits, and compete on a leaderboard. When a period (semester) ends, the group crowdfunds a prize for the top contributor(s).

A similar approach worked with this group two years ago, so adoption risk is low. The goal is to make logging a chore nearly effortless and the reward visible.

Slogan: "Good karma pays out: Rack up your credits for this semester's grand reward."

## Audience and scale

Two research groups plus students: roughly 20–50 users. Trusted, small community. Design for that: one VPS, one Postgres, no horizontal scaling, no heavy anti-fraud machinery.

## Goals

- Log a chore in ≤ 3 taps on mobile.
- Installable PWA with an offline-capable shell.
- Fair leaderboard per period, filterable by Students / Employees / department.
- Admin can approve photo-proof tasks, manage users and periods, and reset passwords without email.
- Social feed that celebrates exceptional chores.
- Deploy to a single Dockerized VPS via GitHub Actions.

## Non-goals

- Public sign-up from outside the organisation, email flows, OAuth.
- Payment handling for the crowdfunding (done outside the app; the app only names the winner).
- Native apps, push notification infrastructure (optional later).
- Tamper-proof fraud prevention. Cheating is a social problem at this scale; controls are speed bumps, not guarantees.

## Anti-goals

- A chore log that takes more than a few seconds, which kills participation.
- Storing photos of routine cutlery tasks (privacy and disk).
- Leaderboards that can be gamed by spamming self-reported tasks.

## Stack (my call, not agreed with the user)

- Frontend + API: SvelteKit (Node adapter), PWA via `@vite-pwa/sveltekit`.
- DB: PostgreSQL with Drizzle ORM.
- Images: local Docker volume, served by Nginx with caching.
- Reverse proxy: Nginx + Certbot, `limit_req_zone` for auth and task endpoints.
- Cutlery check: client-side TensorFlow.js COCO-SSD (classes `fork`, `knife`, `spoon`); image never leaves the device.
- CI/CD: GitHub Actions on push to `main` (lint, tests, multi-stage Docker build, SSH deploy with container swap).
- Tests: Vitest for logic, Playwright for key flows.

## Users, onboarding, auth

- First visit: 3-step carousel (credits, karma levels, semester prize). `onboarding_completed` stored in localStorage and on the profile.
- Sign-up: username + password. Policy: ≥ 8 chars, upper, lower, digit, symbol, live strength meter. Passwords hashed with argon2id.
- Profile: classification `Student` | `Employee`; employees must pick a department: `Software Systems Programming and Development` or `Interactions Research Group`. Optional avatar, cropped and compressed client-side.
- Sessions: long-lived HTTP-only secure cookie session (my call over JWT: simpler, revocable on deactivation).
- Password reset: admin-only. Admin generates a 32-byte random token, 1-hour expiry, single use; stored hashed. Admin hands the URL to the verified user.
- Roles: `user`, `admin`. Deactivated accounts cannot log in; their history stays.

## Tasks

| Task | Pts | Proof | Stored | Flow |
|---|---|---|---|---|
| Put cutlery back in drawer | 1 | Live photo + on-device cutlery detection | No | Auto-approved |
| Empty or run dishwasher | 2 | Self-reported | No | Auto-approved, cooldown |
| Take coffee grounds to 2nd basement | 3 | Self-reported | No | Auto-approved, daily cooldown |
| Bring coffee beans | 5 | Live photo | Yes | Pending admin |
| Bring milk | 3 | Live photo | Yes | Pending admin |
| Descale coffee machine | 10 | Live photo | Yes | Pending admin + auto forum post |
| Deep clean kitchen/fridge | 15 | Live photo | Yes | Pending admin + auto forum post |

Cooldowns (minimum wait between two logs of the same task by the same user), configurable in the tasks table: dishwasher 2 h 30 min (user's call), coffee grounds 24 h, cutlery 30 min (my calls). Admin-reviewed photo tasks have no cooldown.

Points are credited only on approval. Auto-approved tasks credit immediately. Task definitions live in the database so admins can later tune points without a deploy (builder may start with a seed file).

### Photo rules

1. Camera only: custom full-screen `getUserMedia` view (`facingMode: environment`); no file picker. Fallback `<input capture>` only if `getUserMedia` is unavailable. This is a deterrent, not a guarantee, and the spec accepts that.
2. Cutlery task: COCO-SSD runs in the browser; the client submits a "passed" result with no image. The server cannot verify it. Accepted risk at this scale; rate limits cap abuse.
3. Persisted images: client-side canvas to WebP, max 1080 px, quality 0.8, target < 250 KB. Server re-validates type and size and re-encodes (e.g. sharp), strips EXIF.
4. Retention: no automatic deletion. The admin triggers deletion of a period's proof images with a button (in the Image explorer / Periods view), behind a confirmation. Deleting removes the files and marks the submissions as "image removed"; credits and leaderboard history are unaffected.

## Community feed

- Posts with image, author avatar, department, timestamp.
- Reactions: 👏 ❤️ ☕ 🎉 🙌, optimistic UI, one of each per user per post.
- Comments (flat; threading is the builder's call, flat recommended).
- Authors can delete their own posts/comments; admins can moderate any.
- Approving a Descale or Deep clean creates a celebratory post automatically, naming the user and including the proof image.
- All user text sanitised on output (DOMPurify or equivalent).

## Leaderboard and periods

- Ranking by approved credits in the active period.
- Filters: All / Students / Employees, plus department filter for employees.
- Period lifecycle: admin creates a period, ends it. Ending locks scores, records winner(s), and archives the leaderboard. Exactly one active period at a time.
- History page lists past periods with winners and final standings.
- Ties: shared rank; the admin decides on the prize.

## Admin dashboard (`role = admin` only)

1. Review queue: photos, approve (credits points) or reject (canned reasons + optional note). Rejected submissions credit nothing; the user sees the reason.
2. Users: search, change role, deactivate/reactivate, generate reset link.
3. Periods: create, end, view archives.
4. Moderation: delete posts/comments.
5. Image explorer: stored proofs filtered by task, user, date.
6. Analytics: daily/weekly opens and active users, submissions over time, hour/day heatmap, top contributors, task distribution. Computed from an `events` table and submissions; simple SQL aggregates and a lightweight chart library are sufficient.

## Security and operations

- Rate limits at Nginx and in-app on auth, task logging, and reactions.
- Helmet-equivalent headers and a strict CSP in SvelteKit hooks; CORS same-origin only.
- CSRF protection on cookie-authenticated mutations.
- Input validation (zod or equivalent) on every endpoint.
- Container memory limits (e.g. 512 MB app); nightly Postgres dump to a second location (builder's call on target).
- Secrets via environment/GitHub Actions secrets, never committed.

## Left to the builder

- Visual design (modern, clean, mobile-first); cooldown values; flat vs threaded comments; chart library; backup target; exact CI deploy mechanism.
- A first admin must be bootstrapped (seed script or env-defined username).

## Suggested build order

1. Project skeleton, DB schema, auth, roles, bootstrap admin.
2. Task logging for self-reported and auto-approved tasks, leaderboard, periods.
3. Camera capture, compression, cutlery detection, persisted-proof tasks, admin review queue.
4. Feed, reactions, comments, milestone auto-posts.
5. Admin extras: users, reset links, moderation, image explorer, analytics.
6. PWA polish, onboarding carousel, security hardening, Docker/Nginx/CI deploy.
