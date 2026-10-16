# Kitchen Care Credits: design notes (throwaway mockups)

## Identity in three sentences
The interface is built like a kitchen wall: flat glazed tiles set on plaster, separated by grout lines instead of drop shadows. The chore tiles are the only loud element, with point values set huge in Bricolage Grotesque so the app reads as a wall of buttons you press, not a list of cards. Everything else (Geist, one enamel teal, green-tinted greys) stays quiet and Swiss-precise.

## Tokens
Light: plaster #EDF0EB (ground), tile #F8FAF6 (surface), grout #D3D9D0 (lines), ink #1B2420, muted #5E6A62, enamel teal #127A68 (hover #0E6657, press #0B5A4C), wash #DCEBE6, accent text on wash #0B5A4C, glaze (cooldown fill) #DDE5DD.
Pending: wash #F6ECD4, text #7C5509 (the brief's #9A6A12 is kept for icons and borders only; it fails AA for small text). Danger: brick #A63D2F, wash #F4E2DE.
Dark: ground #101613, surface #18211C, lines #2A362F, ink #E8EDE6, muted #9AA89F, accent #3FB59C, wash #1F3A33, glaze #243229, pending text #E0B35A on #2E2613, danger #E0806F.

Type: display Bricolage Grotesque 700/800, tracking -0.02em, balanced wrapping. Body Geist 400/500/600. Tabular numbers everywhere.
Scale (size/line-height): hero figure 72/0.9 display 800; tile points 52/0.95 display 800; h1 32/1.05; h2 22/1.15; lead 17/1.45; body 16/1.5; ui 15/1.35; small 13/1.4. No all-caps, no letter-spaced labels.
Spacing: 4, 8, 12, 16, 24, 32, 48, 64 (gutter 16 on phone, 32 on desktop).
Radius: 20 big tiles, 10 inner controls, 12 avatars, 6 chips. No pills.
Shadow: only (a) the bottom bar, (b) the ready tile's 3px bottom lip that collapses when pressed (translateY 2px). Shadows are tinted with the ground hue, never neutral grey.
Motion: 150-200ms, transform/opacity only, cubic-bezier(.3,1.4,.5,1) for presses, ease-out otherwise.

## The one orchestrated moment
On logging a chore the tile stamps (scale .97 to 1 with a quick teal ring that expands and fades), the +N lifts off the tile and flies to the credit total, which counts up. Everything else has only 150-200ms state transitions. With `prefers-reduced-motion` the fly and count-up are removed; the total just updates.
(Mock: click a ready tile on home.html.)

## Generic-trap review
- Cream + serif + terracotta: no. Cool plaster, sans, teal.
- Near-black + acid accent: dark theme is deep green-black with a lifted teal, nothing acid.
- Broadsheet hairlines: grout lines only separate list rows; hierarchy comes from scale and surface.
- SaaS card kit: tiles are the only boxed objects; feed, leaderboard and queue are flat rows on the ground.
- Template chrome (all-caps eyebrows, 01/02, pill badges, arrows): none. The onboarding step indicator is a real sequence.
