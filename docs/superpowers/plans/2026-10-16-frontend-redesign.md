# Frontend Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restyle the whole app to the approved "kitchen wall" identity, mobile-first, with a bottom tab bar on phones and a collapsible sidebar on laptops.

**Architecture:** Global CSS tokens and base styles (`src/lib/styles/`), small shared Svelte components (icons, buttons, chips, avatars, segmented control), one `AppShell` used by the `(app)` and `(admin)` layouts, then each screen restyled on top of these. Behaviour and routes stay as they are.

**Tech Stack:** SvelteKit 2, plain CSS (custom properties), self-hosted `@fontsource-variable` fonts, Playwright (+ `@axe-core/playwright` dev dependency), Vitest.

**Spec:** `docs/superpowers/specs/2026-10-16-frontend-redesign-design.md` (reference mockups: `docs/design/mockups/`)

## Global Constraints

- Mobile-first: base CSS targets phones; `min-width` media queries add layout (900 px is the shell breakpoint); no `max-width` layout queries.
- Colors/type/spacing/radii/motion exactly as in `docs/design/mockups/tokens.css` and `NOTES.md`; one accent (enamel teal `#127A68`); one green-tinted grey family; dark via `prefers-color-scheme`.
- Fonts self-hosted (Bricolage Grotesque 700/800 display, Geist 400/500/600 body); tabular numbers for numbers.
- Strict CSP stays: no inline scripts, no external font/style requests; inline `style` only for dynamic CSS custom properties.
- Accessibility: AA contrast, 2 px accent focus ring, 44×44 px targets, `prefers-reduced-motion`, `aria-current="page"`, skip link, landmarks, no horizontal scroll at 360 px.
- Voice: sentence case, active voice, no exclamation marks, no all-caps labels, no pill badges, no "→" on buttons.
- No behaviour changes except the two read-only data helpers in Task 3. Existing unit and e2e tests must keep passing.
- Commit messages: one short imperative line, atomic, no AI trailers; no mention of the production host or other apps on it anywhere in the repo.

## Review Focus

- Sidebar collapse state must survive reload with no flash and must work with JavaScript disabled.
- Layout at 360, 390, 899, 900 and 1280 px widths: no horizontal scroll, no overlap of the bottom bar with page content (content padding), no sidebar below 900 px.
- Dark mode contrast for every text/background pair actually used (including tinted washes and the pending/danger states).
- Long usernames, very large point totals (4 digits), empty states (no period, no tasks logged, empty feed) must not break tiles, rows or tables.
- Camera overlay, toasts and form errors keep working with the new styles (focus handling, contrast).

---

### Task 1: Design foundation

**Files:**
- Create: `src/lib/styles/tokens.css`, `src/lib/styles/base.css`, `src/lib/styles/components.css` (shared classes: buttons, chips, form fields, lists/rows, segmented control, tile base, skeleton), `src/lib/icons/*.svelte` (one component per icon, props `size?: number`, `class?: string`, `title?: string`), `src/lib/components/Avatar.svelte`, `src/lib/components/Segmented.svelte`, `src/lib/avatarTint.ts`, `tests/unit/avatarTint.test.ts`, `tests/unit/tokenContrast.test.ts`
- Modify: `package.json` (fonts), `src/app.html` (theme-color metas, `color-scheme`, font preload), `src/routes/+layout.svelte` (import global CSS), `static/manifest.webmanifest` (theme/background colors), `scripts/generate-icons.mjs` + regenerated `static/icons/*` (new palette), `svelte.config.js` (CSP `font-src 'self'` if missing)

**Interfaces:**
- Produces: CSS custom properties (`--ground`, `--surface`, `--line`, `--ink`, `--muted`, `--accent`, `--accent-wash`, `--glaze`, `--pending-*`, `--danger-*`, radii, spacing, type scale, `--ease-press`), utility/component classes (`.btn`, `.btn-primary`, `.btn-quiet`, `.chip`, `.field`, `.row`, `.stack`, `.visually-hidden`, `.skeleton`), `avatarTint(seed: number | string): { bg: string; fg: string }` (deterministic, from a fixed palette of 6 tinted neutrals with AA-contrast initials in light and dark via CSS variables), `<Avatar name, src?, size?, seed? />` (uses `avatarUrl`, initials fallback), `<Segmented options, value, name, href-mode>` (works without JS: links/radios), icon components: `IconHome`, `IconFeed`, `IconBoard`, `IconUser`, `IconCamera`, `IconClock`, `IconHourglass`, `IconCheck`, `IconClose`, `IconCaretLeft`, `IconCaretRight`, `IconShield`, `IconSignOut`, `IconCalendar`, `IconChart`, `IconImages`, `IconUsers`, `IconFlag`, `IconInbox`.

- [ ] **Step 1: Write failing tests.** `tokenContrast.test.ts` parses `tokens.css` and asserts WCAG contrast ≥ 4.5 for every listed text/background pair in light and dark (ink/ground, ink/surface, muted/ground, muted/surface, accent/ground, accent-text/wash, pending text/wash, danger/danger-wash, on-accent/accent) and ≥ 3 for non-text pairs (line/ground is exempt, focus ring/ground). `avatarTint.test.ts`: same seed → same tint, different seeds spread over the palette, string and number seeds, never throws on empty string.
- [ ] **Step 2: Run to verify failure.** `npx vitest run tests/unit/tokenContrast.test.ts tests/unit/avatarTint.test.ts`.
- [ ] **Step 3: Implement** tokens/base/components CSS (mobile-first), fonts via `@fontsource-variable/bricolage-grotesque` and `@fontsource-variable/geist` imported in the root layout (self-hosted; check the built output and that the service worker precaches them), icon components, `Avatar`, `Segmented`, `avatarTint`. Update `app.html` (`<meta name="color-scheme" content="light dark">`, two `theme-color` metas with `media`), manifest colors (`theme_color` `#EDF0EB`, `background_color` `#EDF0EB`), regenerate the PWA icons in the new palette via the script.
- [ ] **Step 4: Run** the new tests, the full unit suite, `npm run check`, `npm run lint`, `npm run build`; run the existing e2e suite (`npm run test:e2e`) to confirm nothing regressed (the old page styles may look odd until later tasks; that is expected, behaviour must not break).
- [ ] **Step 5: Commit** in atomic steps (`feat(ui): add design tokens and base styles`, `feat(ui): add icons and shared components`, `chore(pwa): refresh theme colors and icons`).

### Task 2: App shell (bottom tabs + collapsible sidebar)

**Files:**
- Create: `src/lib/components/AppShell.svelte`, `src/lib/components/SidebarToggle.svelte`, `src/lib/nav.ts`, `src/routes/preferences/nav/+server.ts`, `tests/unit/nav.test.ts`, `tests/e2e/shell.spec.ts`
- Modify: `src/routes/(app)/+layout.svelte`, `src/routes/(app)/+layout.server.ts`, `src/routes/(admin)/+layout.svelte`, `src/routes/(admin)/+layout.server.ts`, `src/hooks.server.ts` / `src/lib/server/publicPaths.ts` only if needed (the preference endpoint requires a session)

**Interfaces:**
- Produces: `NAV_ITEMS` (id, href, label, icon, `match(pathname)`), `ADMIN_NAV_ITEMS`, `isActive(item, pathname): boolean` (segment-aware: `/feed/x` active for Feed, `/feeds` not), `parseNavCookie(value: string | undefined): 'expanded' | 'collapsed'` (unknown → expanded), layout data `{ nav: 'expanded' | 'collapsed', pendingCount?: number }`, `POST /preferences/nav` (form field `state=collapsed|expanded`, zod-validated, sets the cookie (1 year, Path=/, SameSite=Lax), redirects 303 back to the `Referer` path when same-origin else `/`; also accepts `fetch` and returns 204).

- [ ] **Step 1: Write failing tests.** `nav.test.ts`: `isActive` segment cases (`/`, `/feed`, `/feed/123`, `/feeds` not active, `/admin/review` etc.), `parseNavCookie` cases (undefined, `collapsed`, `expanded`, garbage, empty). `shell.spec.ts` (Playwright, real browser): at 390×844 the bottom tab bar shows 4 tabs, there is no sidebar, the active tab has `aria-current="page"`, content is not covered by the bar when scrolled to the bottom; at 899 px still bottom bar, at 900 px sidebar expanded (labels visible); toggle collapses to a 72 px rail (labels visually hidden but present, `aria-expanded="false"`, button name "Expand sidebar", tooltip appears on keyboard focus of an item), reload keeps it collapsed and the server-rendered HTML already carries the collapsed state (check `page.request` response body or `domcontentloaded` class before hydration), with `javaScriptEnabled: false` the toggle still works via form POST; toggling is reachable with keyboard (Tab/Enter/Space); admin sees an Admin group (Periods, Review with badge, Users, Moderation, Images, Analytics) and a non-admin does not; on phone an admin page shows the horizontally scrollable section nav and Profile contains the Admin link for admins.
- [ ] **Step 2: Run to verify failure.**
- [ ] **Step 3: Implement** the shell per the spec (bottom bar < 900 px, sidebar ≥ 900 px, collapse toggle with `aria-expanded`, rail tooltips (CSS + focus-visible, `role="tooltip"` wired with `aria-describedby` or just rely on visible-on-focus label), `inert` / visually-hidden handling that keeps the rail and toggle reachable, skip link, landmarks, content padding for the bottom bar, content max width 960 px). The nav preference endpoint and cookie parsing as above. Move the existing nav links out of the old layouts.
- [ ] **Step 4: Run** unit, lint, check, build, full e2e.
- [ ] **Step 5: Commit** (`feat(ui): add app shell with bottom tabs and collapsible sidebar`, `feat(ui): persist sidebar state in a cookie`).

### Task 3: Home

**Files:**
- Create: `src/lib/components/ChoreTile.svelte`, `src/lib/components/CreditHeader.svelte`, `src/lib/components/RecentActivity.svelte`, `src/lib/server/standing.ts`, `tests/unit/standing.test.ts`, `tests/e2e/home.spec.ts`
- Modify: `src/routes/(app)/+page.svelte`, `src/routes/(app)/+page.server.ts`

**Interfaces:**
- Produces: `getUserStanding(db, userId, periodId): Promise<{ points: number; rank: number | null; ofTotal: number; behindFirst: number }>` (same rules as the leaderboard: approved only, deactivated users excluded, ties share rank; user without points → `rank: null`, `points: 0`), `listRecentActivity(db, periodId, limit = 8): Promise<{ id: number; username: string; taskLabel: string; at: Date }[]>` (approved or auto-approved only; newest first; no images/pending/rejected; deactivated users' entries excluded), `<ChoreTile task state cooldownFraction availableAt onLog />`.

- [ ] **Step 1: Write failing tests.** `standing.test.ts` (real DB): rank with ties (1,1,3), `behindFirst`, user with zero points, deactivated user excluded, no active period handled by the caller, `listRecentActivity` excludes pending/rejected/deactivated and orders newest first and caps the limit. `home.spec.ts`: Home shows credits, rank and the four tile states (seed a user with a recent dishwasher log for cooldown, a pending bean submission, ready tiles, photo tiles); tapping a ready tile logs a chore, the total updates, no layout shift of the tile grid; cooldown fill height reflects the elapsed share (assert the CSS custom property); with `reducedMotion: 'reduce'` the fly/count-up elements are absent but the total updates; empty states ("No active period yet", no recent activity); at 360 px no horizontal scroll; a 4-digit total does not overflow.
- [ ] **Step 2: Run to verify failure.**
- [ ] **Step 3: Implement** the Home screen per the mockup: header (period name, total in the display face, rank "3rd of 28", one-line gap/ready summary), tile grid (2 columns on phone, 3 on desktop, the +15 tile spans the full row), the stamp / fly-up / count-up moment (CSS transforms and opacity only, JS only to toggle classes and animate the number; respects reduced motion), the existing camera/photo submission flow wired into the new tiles (keep behaviour and messages for `detected === false/null`), recent activity list. Keep the existing live cooldown logic (absolute `availableAt` ticking) and the load data shape where possible; add standing and recent activity to the load.
- [ ] **Step 4: Run** unit, lint, check, build, full e2e.
- [ ] **Step 5: Commit** (`feat(home): add standing and recent activity queries`, `feat(home): redesign home with chore tiles`).

### Task 4: Leaderboard, History and Feed

**Files:** Modify `src/routes/(app)/leaderboard/*`, `src/routes/(app)/history/*`, `src/routes/(app)/feed/*`, `src/lib/components/{Post,Reactions,Comments}.svelte`; Create `tests/e2e/screens-community.spec.ts`.

**Interfaces:** Consumes `Avatar`, `Segmented`, icons, tokens (Task D1) and the shell (D2). No server changes.

- [ ] **Step 1: Write failing e2e tests.** Leaderboard: segmented filter works without JS (`?group=`/`dept`), tied leaders render both with rank 1 and the next rank 3, the current user row has a visible "you" marker and is exposed to assistive tech (not colour only), long names truncate without breaking layout, four-digit points align (tabular), empty state when nobody has points. Feed: milestone post with image and a failed image hidden gracefully, reaction chips keep `aria-label`/`aria-pressed`, the viewer's own reaction is visibly distinct (not colour alone), comments expand/collapse, two-step delete still works, compose box validation message styling, "Load more" works, empty feed state. History: past periods with winners, empty state. All at 390 and 1280 px, no horizontal scroll.
- [ ] **Step 2: Run to verify failure** (new assertions).
- [ ] **Step 3: Implement** the restyle per the mockups (flat rows on the ground, grout separators, top rank by scale and a thin accent rule, no trophy icons, rounded-square initials avatars via `Avatar`, reaction chips with 6 px radius, milestone post layout with the proof image area and skeleton while loading).
- [ ] **Step 4: Run** unit, lint, check, build, full e2e.
- [ ] **Step 5: Commit** (`feat(ui): redesign leaderboard and history`, `feat(ui): redesign feed`).

### Task 5: Onboarding, auth, profile, error and offline pages

**Files:** Modify `src/routes/(app)/onboarding/*`, `src/routes/(auth)/**`, `src/routes/(app)/profile/*`, `src/lib/components/PasswordMeter.svelte`, `static/offline/index.html`, `src/routes/+error.svelte` (create if missing); Create `tests/e2e/screens-account.spec.ts`.

**Interfaces:** Consumes D1/D2. No server changes.

- [ ] **Step 1: Write failing e2e tests.** Onboarding keeps working with and without JS (existing e2e stays green) and shows the real step indicator (a real sequence); login/signup/reset forms: labels, inline error styling with `aria-describedby`, password meter accessible (text + not colour only), submit buttons disabled/loading states not blocking no-JS; profile: avatar upload preview and error states, change-password form states; 404 and 500 pages are branded, helpful and offer a way back; offline page renders without JS and with the new fonts/colors (static CSS, no external requests).
- [ ] **Step 2: Run to verify failure.**
- [ ] **Step 3: Implement** the restyles per the mockups (auth pages: calm centered column on phone with the app name in the display face and the slogan, no card chrome; desktop: same column centered; onboarding per `onboarding-light.png`; profile page with the avatar, details and forms as flat sections).
- [ ] **Step 4: Run** unit, lint, check, build, full e2e.
- [ ] **Step 5: Commit** (`feat(ui): redesign onboarding and auth pages`, `feat(ui): redesign profile, error and offline pages`).

### Task 6: Admin screens and overlays

**Files:** Modify `src/routes/(admin)/admin/**/+page.svelte` (review, users, moderation, images, periods, analytics), `src/lib/components/charts/*`, `src/lib/components/CameraCapture.svelte`; Create `tests/e2e/screens-admin.spec.ts`.

**Interfaces:** Consumes D1/D2. No server changes.

- [ ] **Step 1: Write failing e2e tests.** Review queue: pending items with proof image, approve and reject with reason select, readable errors; users: search, role/active actions with confirmation steps and the one-time reset link display with copy button; images explorer grid (thumbnails, filters, per-period delete with confirmation); periods (create/end, pending warning); analytics (charts keep `role="img"` + table alternative; colors come from tokens, work in dark; heatmap scrolls horizontally on phone without scrolling the page; empty state); moderation. All at 390 and 1280 px, light and dark (`colorScheme`), no horizontal page scroll; camera overlay (open from a photo tile with a fake camera device) has visible focus, readable controls and an accessible cancel.
- [ ] **Step 2: Run to verify failure.**
- [ ] **Step 3: Implement** the restyles (desktop admin tables as flat rows with grout separators; on phones rows stack; charts recolored with token variables using the single-hue sequential scale; camera overlay restyled).
- [ ] **Step 4: Run** unit, lint, check, build, full e2e.
- [ ] **Step 5: Commit** (`feat(admin): redesign review, users and moderation`, `feat(admin): redesign images, periods and analytics`, `feat(ui): restyle camera overlay`).

### Task 7: Visual QA and accessibility pass

**Files:** Create `tests/e2e/a11y.spec.ts`, `scripts/screenshots.mjs`; Modify as findings require; Add dev dependency `@axe-core/playwright`.

- [ ] **Step 1: Write the a11y spec**: for each key page (login, signup, onboarding, home, leaderboard, feed, history, profile, admin review/users/analytics) in light and dark and at 390 and 1280 px, run axe and assert zero serious or critical violations; assert no horizontal scroll (`document.scrollingElement.scrollWidth <= innerWidth`) at 360, 390 and 1280; assert focus is visible on the first three tabbable elements of Home.
- [ ] **Step 2: Run to see the baseline**; fix every finding in the relevant components (atomic `fix(ui): ...` commits).
- [ ] **Step 3: Write `scripts/screenshots.mjs`** that logs in as seeded users and saves full-page screenshots of every screen at 390×844 and 1280×800, light and dark, into a directory given as an argument (not inside the repo by default).
- [ ] **Step 4: Run** the full suite (unit, e2e, lint, check, build) and produce the screenshots; the controller reviews them against `docs/design/mockups/` and the reviewer reads them too.
- [ ] **Step 5: Commit** (`test(ui): add accessibility checks`, `chore(ui): add screenshot script`).
