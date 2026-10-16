# Kitchen Care Credits — Frontend redesign

## Intent

The working app looks generic. Give it a distinctive, polished identity without changing what it does. The user approved the direction shown in `docs/design/mockups/` (screenshots and HTML; `NOTES.md` has the tokens and rationale) and added two requirements:

1. **Mobile-first.** Phones are the primary device (people log a chore standing in the kitchen). Base styles target a ~360–430 px phone; wider layouts are added with `min-width` media queries only. No `max-width` media queries for layout.
2. **Collapsible sidebar on laptops.** From 900 px up, navigation is a left sidebar that the user can collapse to an icon rail; below 900 px it is a bottom tab bar.

## Identity (approved)

A kitchen wall: flat glazed tiles on plaster, grout lines instead of shadows, one enamel-teal accent, Swiss-precise type. The chore tiles on Home are the one loud element; everything else is quiet and flat.

- Tokens, type scale, spacing, radii, motion: copy from `docs/design/mockups/tokens.css` and `NOTES.md` (they are the source of truth; contrast-corrected values in NOTES win over the original brief).
- Fonts: Bricolage Grotesque (display, 700/800) and Geist (UI/body, 400/500/600), **self-hosted** (CSP is `'self'`; the service worker must be able to precache them). No Google Fonts requests. Tabular numbers everywhere numbers are compared.
- Icons: line icons in a single 1.5 px stroke style (Phosphor-like), inline SVG Svelte components; not Lucide/Feather. Feed reactions stay emoji (spec).
- Dark mode: `prefers-color-scheme` only (no toggle), tokens defined for both, `color-scheme` set.
- Voice: plain, specific, active, sentence case, no exclamation marks, buttons say what happens.

## Shell

- **< 900 px:** top of page shows the title area of the screen; a 56 px bottom tab bar (Home, Feed, Leaderboard, Profile) with `aria-current="page"` active state (accent text and a 3 px top indicator, not a pill), safe-area padding. Admin entry lives in Profile; admin pages get a horizontally scrollable section nav at the top of the page.
- **≥ 900 px:** left sidebar, **expanded by default** (240 px, icons + labels), with an in-sidebar toggle (button, `aria-expanded`, ≥ 44×44 px target, accessible name "Collapse sidebar"/"Expand sidebar") that collapses it to a 72 px icon rail. In the rail every item keeps its label in the DOM (visually hidden), shows a tooltip on hover and keyboard focus, and has a ≥ 44×44 px target; the active item stays highlighted. The Admin group sits at the bottom of the sidebar for admins, with the Review pending-count badge.
- **Persistence:** the collapsed/expanded choice is stored in a cookie (`kc_nav=collapsed|expanded`, `Path=/`, `SameSite=Lax`, 1 year, not HttpOnly is fine) so the server renders the right state with no flash; the toggle works without JavaScript (a form POST that sets the cookie and redirects back) and is progressively enhanced when JS is available. Unknown cookie values mean expanded.
- Content column max width 960 px on desktop; 16 px gutters on phone, 32 px on desktop.
- Skip-to-content link, `<nav>`/`<main>` landmarks, visible 2 px accent focus rings, `min-height: 100dvh`.

## Screens

Home (credit total, rank, gap to first place, chore tiles in four states, recent activity), Leaderboard (segmented filter, tie-aware ranks, "you" row), Feed (milestone and text posts, reactions, comments, compose), History, Onboarding, Login/Signup/Reset password, Profile (avatar, password), Admin (review queue, users, moderation, images, periods, analytics), offline page, 404/500 pages, the camera capture overlay. All as in the mockups; screens not mocked follow the same system.

### Home tiles

Tile states: **ready** (accent wash, tappable, 3 px bottom lip that collapses when pressed), **cooldown** (flat glaze fill rising from the bottom to the elapsed share of the cooldown, text "ready in 58 min", live countdown as today), **photo** (camera glyph, "photo + review"), **pending** (amber wash, "waiting for review"). The point value is the largest element on a tile. Logging a chore plays the single orchestrated moment (stamp, +N flies to the total, total counts up); `prefers-reduced-motion` removes the fly and count-up.

### New data (small, read-only)

- Current user's standing in the active period: points, rank, points behind the first place (ties share rank; reuse the leaderboard semantics, deactivated users excluded).
- Recent activity: last ~8 approved or auto-approved submissions in the active period (display username, task label, relative time). No images, no pending items, no rejected ones.

## Goals

- Phone-first, thumb-reachable, ≤ 3 taps to log a chore (unchanged).
- WCAG AA contrast for text, visible focus, 44 px targets, reduced motion respected, no horizontal scroll at 360 px.
- All existing behaviour and tests keep working (e2e suite stays green).

## Non-goals / anti-goals

- No behaviour changes beyond the two small read-only data helpers; no new pages.
- No UI framework or component library; no new runtime dependencies other than the self-hosted font packages (dev-only `@axe-core/playwright` for accessibility checks is fine).
- No gradients as decoration, no all-caps eyebrow labels, no pill badges, no card-per-everything layout, no stock photos or illustration blobs.
- Do not break the strict CSP: no inline scripts; inline `style` only for dynamic values (e.g. a CSS custom property for the cooldown fill).

## Left to the builder

Component file layout, exact icon set drawn, class naming, how the tile fill animation is implemented, empty/error/loading state copy (follow the voice rules), image skeletons.
