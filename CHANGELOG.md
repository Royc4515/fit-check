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

## 2026-11-08 (dev-mode overlay on web)

- **Bug fixed:** in the dev server (`pnpm --filter mobile web`) a full-screen red "Uncaught Error: Cannot manually set color scheme, as dark mode is type 'media'" covered the app on every load, so it looked like the app did not open. NativeWind's web stylesheet observer calls `colorScheme.set()`, which throws under its default `darkMode: "media"`. `tailwind.config.js` now sets `darkMode: "class"` (we are light-only and use no `dark:` variants, so nothing changes visually). It never appeared in my earlier checks because those ran against `expo export` builds, not the dev server; reproduced in a dev server and verified gone (no console errors, no overlay).
- **Known, not fixed:** on native (Expo Go / Android) Hermes has no `crypto.subtle`, so supabase-js logs "WebCrypto API is not supported. Code challenge method will default to use plain instead of sha256" and uses a `plain` PKCE challenge. Sign-in still works (Supabase accepts `plain`) but it is weaker than `s256`. Needs a SHA-256 digest polyfill (expo-crypto) before this ships on a phone. On web it only appears when the page is opened from a non-secure origin such as the LAN IP; use `http://localhost:8081`.

## 2026-11-08 (plan + engine v2 part 1 + item drawings)

- `docs/PLAN.md`: the full plan (design, engine v2, AI stylist and modes, intake, calendar, shopping, phone), built from four research passes. Includes proposed PRD/DESIGN corrections (Hebcal geonameid 293397 for Tel Aviv, current Claude/Gemini models, no `temperature` param) and the decisions still open.
- Items are drawn as technical flats in their real colour and pattern (`components/item-art/`, react-native-svg) on all three screens. Set: `design/screens/2026-11-08-item-art-set.png`.
- Engine fixes, each reproduced with a failing test against the real wardrobe first (`candidates.v2.test.ts`, 11 tests):
  - **Cold start offered only T-shirts.** Pre-ranking sorted by recency then id and kept 6, so the 24 button-downs never appeared. Now ranked by fit to the context and interleaved across subcategories.
  - **A warm date had no shoes.** Formality was checked per item; now it is the outfit's slot-weighted mean (top/bottom .35, shoes .2, layer .1) within the band, with per-slot slack for single items.
  - **"Shorts + sweater" on a 16-24C day.** Weather was an overlap test; the base outfit now has to cover the morning and the afternoon, a layer only has to overlap, and shorts/sandals need a morning of 18C+ (the sheet rated some slides 5-40C).
  - **Near-identical candidates.** Final set picked with MMR (lambda 0.7) instead of "not the same top+bottom".
- Look at: run the engine on a weekday, a warm date and Shabbat; the candidates are now coherent (see the commit message for samples).

## 2026-11-08 (real weather and dates)

- Today now uses the real day: Israel-local date, Hebrew date and holidays from Hebcal (geonameid 293397, Tel Aviv), candle lighting on Fridays and holiday eves, and the Open-Meteo hourly forecast summarized over 07:00-19:00 (feels-like min/max, rain, wind, UV, sky). Saturdays and Yom Tov switch the engine to the Shabbat rules. `features/today/mock.ts` is gone.
- Pure summarizer in the engine (`weather.ts`) with 6 tests on a recorded real response (`__fixtures__/open-meteo-2026-11-08.json`, a showery day: 16-21C, 63% rain). API responses are validated with zod (`packages/schema/src/external.ts`).
- Each source fails alone: weather falls back to a 3h cache, then a day-old one, then "no weather data" with a mild default the screen never presents as a forecast. Attribution for both APIs (CC BY 4.0) is shown under the weather line.
- The explanation is now a true sentence built from the engine's facts (day, feels-like range, layer, rain, Shabbat), in place of the static mock text. It stays as the fallback when the AI stylist (phase B) fails validation.
- Not verified here: Open-Meteo from this sandbox returns 429 (shared IP, as the research warned); the recorded response came through another route. Hebcal Friday/Yom Tov parsing was checked against live responses.

## 2026-11-08 (choose a location)

- New Location screen (tap "מיקום: ..." under the weather line on Today): the default (Tel Aviv), the phone's current location (expo-location, works on Android and in the browser), or any city via Open-Meteo's free geocoder. Stored on the device, not in Supabase: "current location" only means something on the device you hold.
- Weather, the local date and Shabbat times follow the chosen place. A chosen city is sent to Hebcal by its GeoNames id, so local customs apply (Jerusalem lights candles 40 minutes before sunset; coordinates alone get the generic 18, which the screen says when "current location" is used). The Israel holiday schedule (`i=on`) is applied only when the place is in Israel's time zone; abroad Yom Tov is two days.
- Caches are keyed by place, so switching cities never shows the old city's weather.
- Verified: geocoder and Hebcal (by id and by coordinates) against live responses. Not verified: the screen itself and the GPS permission flow, which need a signed-in session and a real device/browser.

## 2026-11-08 (brand: Fit Check)

- Name settled: Fit Check. Mark: "FC" in Frank Ruhl Libre inside a hairline square (Totême/SSENSE restraint: ink on ivory, no colour, no gradient). Rendered from the app's own font file into `assets/`: app icon, Android adaptive foreground/background/monochrome, favicon, splash (`expo-splash-screen`, ivory, 120px).
- Sign-in is now a cover page: monogram, the real Hebrew date (Hebcal), the wordmark, a one-line tagline, a still life of three drawn garments overlapping by 8px, then the single burgundy action. `components/brand/Monogram.tsx` and `StillLife.tsx` are reusable.
- Fixed on the way: Hebrew set in Plex Mono fell back to a system font with wide gaps (Plex Mono has no Hebrew); Hebrew text is now always in the body font, mono only for numbers. The cover's free height is taken by the composition instead of a dead band above the button.
- Look at: `design/screens/2026-11-08-sign-in*.png`, `2026-11-08-app-icon.png`. Not verified: the icon and splash in an Android build.
- Known waste, to fix: the cover loads the whole day context (including weather) when it only needs the Hebrew date.
- Plan: added stage G (personal colour palette, research-backed) to `docs/PLAN.md`; it needs a migration and waits for a go.

## 2026-11-08 (editorial redesign, A3)

- PR #1 merged to `main`. Vercel project creation was refused for this session's Vercel connection (403); the owner creates it from the dashboard (see the session notes).
- Screens split into a container (loads data) and a view (pure props): `features/today/TodayView.tsx`, `features/wardrobe/WardrobeView.tsx`, `ItemContent` in `app/item/[id].tsx`. This made it possible to render and photograph the signed-in screens with the real wardrobe for the first time.
- Today: garments carry a mono index (01-04) and the names moved to a numbered caption legend (Hebrew type + name); the reason is a pull quote in the display face under an ink rule, with practical notes beneath; the weather is a three-cell data strip (feels like, rain, sky); blocks enter in reading order (180ms, 40ms apart).
- Wardrobe: "108 items · 6 categories" instead of a bare number; section heads in the display face with a mono count and a strip of the category's real colours; captions show the Hebrew type and colour; press feedback (scale 0.97, 120ms).
- Item: tags as a spec table on hairlines (type, colour swatch, pattern, material, seasons, formality, range); "goes with" as numbered trios of drawn garments.
- New building blocks: `components/editorial/{Reveal,DataStrip,SpecTable}.tsx`, `components/PressScale.tsx`.
- Bugs found by looking: Hebrew mixed into Plex Mono again (weather line, formality line), now split into labels and mono numbers; digit-only values hugged the wrong edge in RTL because react-native-web renders text with dir="auto" (fixed by aligning the container, not the text).
- Look at: `design/screens/2026-11-08-*-editorial*.png` (rendered from the real fixture with a sample showery day, not from a live session).

## 2026-11-08 (Vercel deep links)

- The web app is live at https://fit-check-app-xi.vercel.app (project `fit-check-app`, production from `main`). Verified: the sign-in cover renders in Hebrew and English, `/wardrobe` and `/location` load.
- **Bug fixed:** deep links such as `/item/<id>` returned Vercel's 404. The SPA rewrite pointed at `/index.html`, but with `cleanUrls` on, `/index.html` itself 308-redirects to `/`, so the rewrite target never resolved. It now points at `/`; the client router reads the real URL. Takes effect on the next production deploy (merging this PR).

## 2026-11-08 (A6: wear logging and feedback)

- "לובש" now records the outfit: an `outfits` row, its `outfit_items`, and a `wears` row (feedback `worn`); Today then shows "נרשם: זה מה שלבשת היום" with undo, and the sheet goes away for the day. Writes go to the DB before the screen changes; a failed write says so and changes nothing.
- "דלג" records a skip and shows the next candidate, with "לא אהבתי את השילוב" (turns the skip into `disliked`) and undo. Skipped outfits stay out of today's suggestions after a reload.
- Learning: worn raises every pair in the outfit by 0.05, disliked lowers it by 0.1 (PRD 4), clamped, written to `pair_weights`; undo reverses it exactly. Pure engine functions `feedbackUpdates` / `applyPairUpdates`.
- Freshness: the last 21 days of worn outfits now feed the engine's `recent_wears` (was always empty).
- "החלף פריט": the caption rows become tappable; each shows up to three alternatives for that slot, scored as the whole outfit, inside today's filters and formality band, never two that look alike (engine `swapOptions`). A swapped outfit is recorded with source `swap`.
- "יותר חם / קר / רשמי / פחות רשמי" nudge today's request (3C / one formality step per tap, engine `adjustRequest`), shown as "כוונון להיום" with reset. Session-only: a persistent personal offset needs a profile column (a migration, so it waits for a go).
- Item screen: "איפה הפריט" control (בבית / בכביסה / במילואים / מושאל), optimistic with rollback; only items at home are suggested.
- Tests: engine 49 (16 new: feedback, undo, adjustments, swap), schema 8 (wear row parsing). DB writes checked under RLS as the owner in a rolled-back block.
- Not done (open decisions): automatic laundry after wearing; persisting "I run cold"; the reserve-duty "חזרתי" flow.
- Look at: `design/screens/2026-11-08-today-{skip-feedback,swap,worn}.png`, `2026-11-08-item-availability.png`; `apps/mobile/src/data/feedback.ts`, `useFeedback.ts`, `features/today/outfit.ts` (`planToday`).
- Reserve duty (PRD 4): "יוצא למילואים" on the Wardrobe screen turns the grid into a picker (tap to pick, 1px ink frame); "סמן כבמילואים" moves the picked items to `away` in one request. While anything is away the header shows the count with "חזרתי, הכל לכביסה" / "חזרתי, הכל נקי". Items not at home are faded in the grid and their caption says where they are. Look at `design/screens/2026-11-08-wardrobe-reserve-*.png`.
- Laundry by wear count (migration `0003_laundry.sql`, applied): `items.washed_at` plus SQL function `wear_counts_since_wash` (RLS-scoped, counts worn wears since the last wash; derived, so undo can never make it drift). After "לובש", engine `dueForLaundry` sends what reached its limit to the laundry: T-shirt and polo 1, shorts 2, button-down 3 (worn over an undershirt), sweatshirt 3, knit / chinos / trousers 4, jeans 6, shoes never (`LAUNDRY_AFTER_WEARS` in config.ts). Today says "הועבר לכביסה: …" with "השאר בבית"; undoing the wear brings them back too. Back home from laundry or from base resets the count. 4 engine tests (53 total); SQL checked under RLS in a rolled-back block.
- Reserve picker shows the usual first (T-shirts, sport-tagged items, slides) with "הצג את כל הארון", plus a reminder for what is not in the wardrobe: uniform, army boots, pyjamas.

## 2026-11-08 (learned warm / dressy lean)

- Each worn outfit now stores the total adjustment it was chosen under (inside `outfits.breakdown`, no migration). Engine `learnedAdjustment`: with at least 5 worn outfits in the last 30 days and a real majority (>50%) leaning the same way, that lean (capped at one step per axis) becomes every day's starting point; today's taps add on top. Totals, not taps, are stored, so a correct lean is stable and tapping against it erodes it (5 tests, 58 total).
- Today shows "מותאם לך מהלבישות האחרונות: …" when a lean is active. `RECENT_WEARS_DAYS` 21 → 30 (freshness windows are 3 and 14 days, unaffected).

## 2026-11-08 (stage B: AI stylist)

- Edge Function `style-outfit` (deployed, verify_jwt on): validates `StylistInput` with zod (at most 8 engine candidates; the wardrobe never leaves the app), calls Claude Sonnet 5.5 (`claude-sonnet-5-5`, effort medium, structured JSON output whose `chosen_outfit_id` is an enum of the offered ids, server-side refusal fallback `fallbacks: "default"`), re-validates with `StylistOutputSchema`, and logs every call to `ai_calls` with tokens and estimated cost (Sonnet 5.5 list price $2 / $10 per MTok). Spend guard: 30 calls per user per rolling 24h. Any failure returns `ai_failed` and the app keeps the engine's top pick with the template sentence (CLAUDE.md fallback).
- App: Today asks the stylist (debounced 600ms, answers cached per day and candidate set) and shows its pick with its Hebrew sentence as the pull quote; after a swap the template text returns. `planToday` takes the stylist's `preferredId` and exposes the open `candidates`.
- `packages/schema` imports now carry explicit `.ts` extensions (`allowImportingTsExtensions` in tsconfig.base and the app): the hosted Edge runtime does not resolve extensionless imports, which crashed the first deploy at boot.
- Needs: `ANTHROPIC_API_KEY` as a Supabase Edge Function secret. Until it is set the function answers `ai_failed` and Today looks exactly as before.
- Look at: `supabase/functions/style-outfit/index.ts`, `supabase/functions/_shared/ai/anthropic.ts`, `design/screens/2026-11-08-today-stylist.png` (rendered with a fake stylist).
- Stylist persona (`supabase/functions/_shared/ai/stylist-persona.ts`, deployed as style-outfit v3): a female personal stylist who specialises in everyday menswear and knows the religious dress code without preaching; writes to him in masculine singular and about herself in feminine; one or two sentences, up to 35 words, reason first, concrete numbers, at most two items named in Hebrew by garment and colour (never brand), no exclamation marks, emojis or AI clichés (a banned-word list), with an English-to-Hebrew garment and colour glossary, allowed styling terms, and good/bad examples. Written in Hebrew so the register carries over.

## 2026-11-08 (stage C, first slice: separating garments from photos)

- Edge Function `intake-separate` (deployed): takes a photo the user uploaded to the private `originals/{uid}/` bucket; Claude Haiku 5.5 (vision, structured JSON) lists the garments with a category and a precise description (max 6); Gemini `gemini-3.1-flash-lite-image` extracts each one as a product photo on white, in parallel; PNGs go to `cutouts/{uid}/intake/{photo}/{n}.png`. Every call is logged to `ai_calls` with cost (Gemini paid tier: $0.0336 per output image). Spend guard: about 40 photos per user per 24h. Nothing is written to `items` yet.
- App: "הוספת בגדים" screen (`/intake`, linked from the Wardrobe header): pick up to 10 photos, each is downscaled to 1600px JPEG, uploaded, separated, and shown with its results; status is text, never a spinner. The screen states that this is a quality check and nothing is saved yet.
- `expo-image-picker` and `expo-image-manipulator` added (photo permission text in app.json).
- Needs: `GEMINI_API_KEY` (set) and billing on in Google AI Studio (image models have no free tier; paid-tier data is not used for training).
- Next: run the 10-photo quality test, then tagging (Haiku against the frozen tag schema) and the confirm screen that saves to `items`.
- Look at: `supabase/functions/intake-separate/index.ts`, `supabase/functions/_shared/ai/gemini.ts`, `design/screens/2026-11-08-intake.png`.
- Intake switched to free by default (Roy, 2026-11-08: no real money): `gemini-2.5-flash` on the Gemini API free tier returns a box and a pixel mask per garment, and the function cuts the real photo pixels onto a transparent background (`_shared/image/cutout.ts`, imagescript, 3 Deno tests). Cost $0 per photo; Haiku listing removed. The paid redraw (`gemini-3.1-flash-lite-image`) is now an optional "שיפור עם AI" per garment, which answers "billing_required" while the project has no billing. Free-tier caveat: Google may use free-tier inputs to improve its products.
- Deploy note: Edge Functions were deployed through the Supabase MCP with trimmed copies of the shared schema files (same exports). A `supabase functions deploy` from the repo is the source of truth and gives the same behaviour.
- Correction, same day: segmentation masks dropped. Research showed `gemini-2.5-flash` masks are being retired (its requests move to 3.5 Flash-Lite on 2026-12-01, and Gemini 3.x has no masks), and the imagescript build crashed the Edge runtime (WORKER_ERROR). Now: `gemini-3.8-flash` (free tier) returns per garment a box, category, description and issues (occluded, overlapping, cut_off, wrinkled, blurry, dark); the app crops the real photo with expo-image-manipulator and uploads the crops itself. Garments with issues offer "צלם שוב לבד" first, then "שיפור עם AI" (paid redraw that completes hidden parts; billing_required while there is no billing). The tag-based drawing stays only as the last resort (Roy).
- Open spec question: background removal. Modal needs a card even for its free credits; the $0 option is an MIT model (BiRefNet-lite / BEN2 ONNX) running on the device. CLAUDE.md still says "Cutouts come from the Modal worker" and needs Roy's decision before changing.
