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

## 2026-11-07 (session 1: Item screen + shared-element transition)

- Item screen at `apps/mobile/src/app/item/[id].tsx` (+ `features/item/`): hero on `--ivory-deep` at 60% of the screen height, name in display-xl, tags as one running line (not chips), formality and temperature range in Plex Mono, and "goes with": up to 3 engine outfits built around the item (`getMockOutfitsWith`, anchored, weather = the item's own range, filtered to outfits that really contain it).
- Shared-element transition (DESIGN.md section 4, animation 1): the picture flies from its grid cell to the hero slot in 420ms ease-out, the ivory page fades in over the wardrobe (180ms) and the text follows 100ms later; back retraces the flight to the cell's current rect. Measured per frame in Chromium: starts on the cell rect `[276,654,116x155]`, lands on `[0,0,412x549]` at ~415ms, returns to the cell on close.
- **Deviation from CLAUDE.md ("Motion on web behind a platform split"):** one code path on Reanimated shared values instead of `sharedTransitionTag` + Motion. `sharedTransitionTag` sits behind the `ENABLE_SHARED_ELEMENT_TRANSITIONS` static flag (native rebuild) and does not exist on web; Motion is not installed. Say if you want the two-stack version.
- Things that bit, relevant to later animation work:
  - Animating `left/top/width/height` never reached the DOM on web (only opacity/transform did), so the hero is laid out once at its final rect and animated with transform + opacity only (also cheaper on native).
  - The item route mounts more than once per push, so a consume-once origin was taken by an instance that was then replaced and the survivor never flew. The origin is now keyed by item id, read without consuming, and expires after 3s (`features/item/transition.ts`).
  - Callback refs: a cell needs one ref feeding both its local measuring and the registry the item screen uses to fly back.
  - `ViewProps` has no `dir` in RN's types; the root layout spreads a typed object (see session notes above).
- Verified: web (Chromium, he/en/desktop). **Not verified:** native Reanimated behaviour (measureInWindow offsets under edge-to-edge Android, the transparentModal route on a device), hardware back on Android (handler added, untested), and deep links: a static web export has no `/item/<id>` file, so a direct URL needs a rewrite to `index.html` on the Vercel project (not set up).
- Not done on purpose: wear history (needs `wears`), edit, availability change, the item's notes (the sheet notes are raw English like "match with belt 1201"), and a "not found" screenshot.
- Screenshots: `design/screens/2026-11-07-item*.png`; `-item-transition.png` is six frames of the flight from a screen recording.

## 2026-11-07 (session 1: screens read from Supabase)

- Today, Wardrobe and Item now read the signed-in user's wardrobe and pair weights from Supabase instead of the fixture. The fixture is no longer imported by the app, so the wardrobe is out of the bundle (CLAUDE.md). Still mock, in `features/today/mock.ts`: the date, weather, Hebrew date and the explanation text (each needs Hebcal / Open-Meteo / `generate-daily`).
- Auth: Google sign-in (`features/auth/`), a session provider, and route guards in the root layout (signed out can only reach `sign-in`). Native session persistence was missing entirely (supabase-js keeps it in memory without a storage adapter); now AsyncStorage on native, localStorage on web. New deps: `@react-native-async-storage/async-storage`, `expo-web-browser`.
- Data layer (`src/data/`): one `WardrobeProvider` shared by all screens, stale-while-revalidate with a per-user cache (cache version covers format changes), quiet loading and error states with retry (`WardrobeGate`). A row that violates the tag schema is skipped and logged with its id rather than blanking the wardrobe.
- `packages/schema/src/db.ts`: the single row <-> `Item` mapping used by the app (read) and the seed script (write). 6 tests, including a round trip over all 108 real items. Hot columns are derived from `tags` on write and never read back.
- `scripts/seed-wardrobe.ts` (`pnpm seed:wardrobe`): idempotent seed of the fixture for one user. Dry run by default; `--write` needs `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` in your shell; refuses to run if the user already has items unless `--force` (a re-seed would overwrite tags you corrected in the app).
- Verified against the live project (`ftjerbwrzjprfikxkukj`, no migration needed): anon reads of `items` return `[]`, anon writes fail with 42501, a forged JWT gets 401. In a transaction that always aborts (nothing persisted; re-checked: 0 test users, 0 items, 0 pairs afterwards) as an `authenticated` user: the owner reads exactly the app's `select`, another user sees 0 rows, a cross-user write is blocked by RLS, pair ids are ordered; those exact rows pass `itemFromRow`. In the browser: signed out shows sign-in, a forged session reaches the real 401 and shows the retry state.
- **Blocking, and yours:**
  1. Google sign-in is NOT enabled on the project (`Unsupported provider: provider is not enabled`). Create a Google OAuth client, enable the provider in Supabase (Authentication > Providers), and add the redirect URLs: `fitcheck://auth` (native, already in `config.toml`) and the web origin you deploy to (`http://localhost:8081` for local web).
  2. Sign in once, copy your user id (Authentication > Users), then: `SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... pnpm seed:wardrobe -- --user-id <uuid> --write`.
  3. Copy `apps/mobile/.env.example` to `.env.local` (I created one here for the cloud session; it is gitignored and holds only the public key).
- **Not verified:** a successful sign-in end to end, the signed-in screens against real rows, the native OAuth round trip (`openAuthSessionAsync` + PKCE code exchange), and session persistence on a device. Everything on the path up to the Google redirect and from the database to the parsed `Item` is verified; the middle is not.
- Known rough edge: on web, if the provider is misconfigured the browser lands on Supabase's raw JSON error page, because the redirect happens in the browser before the app can catch it.
- Not done: the pre-existing `match_items()` service-role bug and the generated-columns idea (proposed in the earlier review, still needs your go: schema change).

## 2026-11-08 (correction: sign-in flow type)

- **Bug fixed:** supabase-js 2.119 defaults to the `implicit` OAuth flow (tokens in the URL hash), but `features/auth/signIn.ts` on native exchanges a PKCE `?code=`. Native sign-in would have reported "failed" on every attempt. `createClient` now sets `flowType: "pkce"`; verified in the built web app that the authorize request carries `code_challenge` (`s256`). Web was unaffected either way (`detectSessionInUrl` handles both). The native round trip is still unverified on a device.
- **Correction to the entry above:** `config.toml`'s `additional_redirect_urls` only applies to the LOCAL Supabase stack. The hosted project's redirect allow-list is set in the dashboard (Authentication > URL Configuration), so `fitcheck://auth` is not configured there yet.
