# Changelog

## 2026-11-06

- Repo scaffolded: monorepo (pnpm + turbo), `packages/schema`, `packages/engine` with tests on the real wardrobe fixture, first Supabase migration, Edge Function stubs, Modal worker stub, Expo app skeleton with i18n (he/en) and design tokens.
- Wardrobe sheet exported to `scripts/data/wardrobe.csv` (109 items) and converted to `packages/engine/__fixtures__/wardrobe.json` by `scripts/import-sheet.ts`.
- Look at: `packages/engine/src/engine.test.ts` for what the engine already guarantees; `supabase/migrations/0001_init.sql` for the schema.
- Not done yet: the "Today" screen (session 1 of Claude Code builds it), any AI call, any Supabase deploy.

## 2026-11-06 (review)

- Supabase project `ftjerbwrzjprfikxkukj` (eu-central-1) created; migrations 0001 and 0002 applied; security advisor clean.
- Engine review fixes: never-worn ordering was non-deterministic (NaN comparator), virtual items could not reach the pre-purchase check, disliked pairs lost their sign, navy was treated as a colored hue, layer formality had no upper bound, an accessory anchor dropped itself. 5 tests added (16 total).
- Open (needs a go, schema change): `match_items()` uses `auth.uid()` and returns nothing when called with the service role from an Edge Function; proposed 0003 adds a `p_user_id` parameter. Same migration could turn the duplicated hot columns on `items` into generated columns from `tags` to prevent drift.

## 2026-11-06 (session 1: Today screen)

- "Today" screen built in `apps/mobile/src/app/index.tsx` with `features/today/` (mock data from the engine on the real wardrobe fixture, weekday, 16-24C; asymmetric composition; Reanimated 4 + Gesture Handler action sheet). No Supabase, no AI.
- Screenshots in `design/screens/` are **web renders (react-native-web, Chromium, 412x915 @2x), not Android emulator captures**: the cloud session has no emulator. Native Reanimated/Gesture Handler behaviour and `I18nManager` RTL are unverified until run on a device.
- Root-cause fixes found while rendering, relevant to every later screen:
  - `className` is silently ignored on Reanimated's `Animated.View` (NativeWind). Style it inline from `tokens.ts`.
  - react-native-web resolves `start`/`end`/`marginStart` from a locale context that only a `dir` prop provides; `document.dir` alone flips flex rows but not logical props. Root layout now sets `dir`.
  - The static web export hydrates with the server's locale and window width (0) and React does not patch attributes, so SSR output won. Root layout now renders nothing until mounted.
  - Spacing scale has no `0.5`; `h-0.5` compiles to 0px.
- Mock-only, to delete when wired to `generate-daily`: the relative import of `packages/engine/__fixtures__` into the app (CLAUDE.md forbids the wardrobe in the bundle), the hardcoded Hebrew date, the static explanation string `today.explanationMock`.
- Look at: the three PNGs (closed / sheet open / English LTR); `ActionSheet.tsx` for the gesture; `OutfitComposition.tsx` for the percentage layout.
- Proposed spec edit (not applied): the DESIGN.md spring (damping 28, stiffness 320, mass 1) has damping ratio ~0.78, i.e. a ~2% overshoot, which sits uneasily next to "no bounce". Say if you want it critically damped (damping ~36).

## 2026-11-06 (session 1: spring + Wardrobe screen)

- Spring closed to `damping 36` (critically damped, no overshoot) in `tokens.ts` and DESIGN.md section 4, per review.
- "Wardrobe" screen: `apps/mobile/src/app/wardrobe.tsx` + `features/wardrobe/`. Grid grouped by category (3 columns on phone, 5 on web >= 900px, content capped at 1120), no card chrome, name in body-sm below, 280ms layout animation on the UI thread when filtering, one scrolling chip row (season, color; availability appears once data has more than one value). Filter logic is pure (`filters.ts`). Text links connect Today and Wardrobe.
- Fixture parsing moved to `src/mock/wardrobe.ts`, the single mock import to delete when screens read from Supabase.
- Screenshots (web renders again, not emulator): `design/screens/2026-11-06-wardrobe*.png`; Today re-shot for the nav link.
- Not done, on purpose: formality filter (needs a range control, not a chip), item screen and the shared-element transition, virtualization (grid renders all ~108 cells; must become a FlatList once images arrive), tests for `filters.ts` (the app has no test runner yet).
- Note: the fixture has 108 items, PRD says 109.
