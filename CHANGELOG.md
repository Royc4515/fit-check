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
- Paid redraw uses its own key, `GEMINI_IMAGE_API_KEY`, from a second Google project with billing and the AI Pro credit, so detection stays on the free tier of the main project. Hard cap: $8 of redraws per calendar month (UTC), summed from `ai_calls`; above it the function answers "monthly_limit".

## 2026-11-08 (fix: every signed-in AI call was 401)

- `style-outfit` and `intake-separate` called `supabase.auth.getUser()` without the token. On the server that reads a stored session (none) and ignores the Authorization header, so every real call came back 401 before reaching Claude or Gemini (photos uploaded, nothing detected, no stylist sentence, no `ai_calls` rows). Both now pass the bearer token: `getUser(token)`. Redeployed both.
- A temporary `env-check` diagnostic (lists env var names only) was deployed and then replaced by a 410 stub; it can be deleted from the Supabase dashboard.
- Still 401 after passing the token. Both functions now share `supabase/functions/_shared/auth.ts`: `getClaims(token)` (JWKS, no Auth round trip) with `getUser(token)` as fallback, and on failure the 401 body and function log carry the reason (never the token). `@supabase/supabase-js` pinned to 2.119.0 in the functions import map. intake-separate redeployed; style-outfit follows once a real call confirms the fix.
- Root cause found with a temporary diagnostic: from inside the Edge runtime, every Supabase request that carried the user's real token (getUser, getClaims, storage as the user) came back as an HTML page, while the same requests without it returned JSON. `_shared/auth.ts` now verifies the JWT locally against `SUPABASE_JWKS` (ES256, issuer `{url}/auth/v1`, audience `authenticated`) with `jose` and never forwards the token; intake-separate reads and writes storage with the service role, kept to the user's folder by `ownPath()`. 2 Deno tests (valid token; wrong issuer, wrong audience, foreign key, no token). intake-separate redeployed; style-outfit next.

## 2026-11-09 - Intake: auth works, retry when Gemini is overloaded
- Intake auth confirmed working on a real photo (local JWT check). The first real detection failed with Google 503 "high demand".
- detectGarments now tries gemini-3.8-flash twice, then gemini-3.5-flash-lite (both free tier); 429/500/503 show "Google is busy, try again" instead of a generic error. ai_calls records which model answered.
- Look at: ai_calls.model on the next intake.

## 2026-11-09 - Intake: real tagging, review screen, saving to the wardrobe
- Why: Roy saw wrong type (sweater as shirt), shade and fabric. Causes found: no tagging step existed (only detection's
  6 coarse labels), the redraw was described from detection's guess (melange tailored trousers drawn as olive chinos),
  detection had fallen back to the weak free model, and the test photos were ~200 px (crops 45-130 px).
- intake-tag (new, deployed): Claude tags a crop with the full frozen ItemTags, using a fabric/type/colour guide, the
  owner's wardrobe names, his last 15 corrections, and an optional care-label photo (composition settles wool vs cotton).
  Default model Haiku 5.5: on the real crops Sonnet 5.5 was no more accurate and 15x the cost (0.1 vs 1.7 cents).
- Migration 0004_tag_corrections: proposed vs saved per confirmed garment, with the changed fields; feeds the prompt.
- Detection: paid gemini-3.8-flash first (4 s, ~0.2 cents a photo, verified), free key as fallback, low thinking.
  The $8/month Google cap now covers paid detection and redraws together.
- App: "one garment" mode (whole frame, no detection) as default, "several garments" mode, low-resolution warning,
  review per garment (chips per field, the tagger's value first, "worth checking" on uncertain fields), care-label photo,
  redraw from the confirmed tags, save to items (+ tag_corrections), wardrobe reload.
- Look at: design/screens/2026-11-09-intake-review.png, intake-modes.png; ai_calls rows with task 'tag'.

## 2026-11-09 - Intake: "one garment" means the one in front
- Roy's closet photo of a brown shirt came back as two garments (the black shirt hanging behind it as "outerwear").
- "One garment" mode now runs detection with `single: true`: a dedicated prompt returns only the main garment (front,
  centre), ignoring clothes behind or around it, and the app crops to it. Falls back to the whole frame if detection fails.
- The tagger is told to tag only the front garment and ignore other clothes' colours.
- Look at: one-garment photo taken in the closet; ai_calls shows one 'separate' and one 'tag' row per photo.

## 2026-11-09 - Background removal (Modal worker)
- worker/app.py: separate `Cutter` (CUDA + cuDNN image, onnxruntime-gpu, rembg birefnet-general, T4, scales to zero after
  2 min) and `Embedder` classes; fixed the FastAPI `Request` injection; token check; input size cap; trimmed PNG + 400 px thumb.
- intake-cutout (deployed): crop -> worker -> `<crop>-cutout.png` + `-thumb.png` in Storage, ai_calls row (provider modal,
  cost from wall time x T4 rate), 120/day cap. Answers `not_configured` until MODAL_CUTOUT_URL and MODAL_WORKER_TOKEN are set.
- App: each garment is tagged (from the crop) and cut out in parallel; the review shows the cutout when ready; the item saves
  the cutout and thumb (a redraw still wins if the user asked for one).
- Not deployed to Modal yet: the sandbox cannot reach Modal's gRPC API. Steps in worker/README.md.

## 2026-11-09 - Show the real photo, not the drawing
- Roy: items saved from photos showed the generic drawing. The image was saved (items.cutout_path) but every view drew ItemArt.
- ItemArt takes `cutoutPath`: with a path it shows the stored image (public cutouts bucket), else the drawing (sheet items).
  Wired in the wardrobe grid, item page, "goes with", Today composition and swap options.
- Look at: design/screens/2026-11-09-wardrobe-photo.png (Tsumi Mandarin Collar).

## 2026-11-10 - Cutout worker on CPU (no card needed)
- Modal requires a payment method for any GPU function; Roy wants no card on file. Cutter now runs on 8 CPU cores
  (debian_slim + onnxruntime CPU), about 10-20 s a photo, still free within the $30/month credit. Embedder moved to CPU too.
- intake-cutout timeout 100 s -> 140 s (cold start on CPU), cost estimate per CPU core-second. Redeployed.
- How to go back to a T4 is in the comment above `cutout_image` in worker/app.py.
- Bake the BiRefNet weights into the cutout image at build time. Downloading them at container start (~3 min at
  ~5.5 MB/s, repeated by every parallel container) hit the container timeout, so the first deploy never answered.

## 2026-11-10 - Cutout fixes: AI redraws, speed, existing photos
- AI redraw: the slow cutout of the original no longer replaces the redraw on screen; the redraw itself is now cut out
  (it comes on white), and saving prefers redraw-cutout > redraw > original cutout > crop. intake-cutout accepts
  `-enhanced` paths (redeployed).
- Speed: Cutter uses Modal memory snapshots (`enable_memory_snapshot`, `@enter(snap=True)`), so a sleeping worker
  restores the loaded model instead of reloading 1 GB (the first real call took 112 s). Needs a `modal deploy`.
- Existing photo items: one-off `cutout-backfill` function (code-guarded, expires 2026-11-10 23:00 UTC) cuts out
  every photo item that has no `-cutout.png` yet; retired after the run.

## 2026-11-10 - Spreadsheet items deleted; Today says what is missing
- At Roy's request, deleted the 108 items imported from the spreadsheet (their pair weights cascaded). The wardrobe now
  holds only the 41 items added from photos; tag_corrections and ai_calls are kept.
- Today: when the wardrobe has no tops, bottoms or shoes at all, the empty state names what is missing and links to
  "add clothes" instead of the generic "no suggestion today". Screenshot: design/screens/2026-11-10-today-missing.png.

## 2026-11-10 - Edit items after they are added
- Item page: "עריכה" opens an editor (features/item/ItemEditor.tsx): name, brand, type, colour, pattern, fabric, fit,
  seasons (at least one) and formality 1-10, saved together; the hot columns stay in step with `tags` (data/items.ts).
- Image actions: "החלפת תמונה" (new photo, background removed) and "שיפור עם AI" (redraw from the original crop, never
  from an earlier redraw, then cut out). Each redraw now gets its own file (`-enhanced-<ts>.png`) so an item can be
  redrawn again; intake-separate redeployed.
- "הסר מהארון": two taps; archives the item (status `archived`) so wear history stays and it is never listed or
  suggested again.
- Screens: design/screens/2026-11-10-item-view.png, 2026-11-10-item-edit.png.

## 2026-11-10 - Duplicate check, sleeve length, name in the redraw prompt
- intake-tag: after tagging, up to 4 look-alikes (same subcategory, colour and sleeve length, active, with an image)
  are compared with the new crop by Claude Haiku (_shared/ai/duplicates.ts). Only a high-confidence match is returned
  as `duplicate`. Daily tag cap 80 -> 160 (two calls per garment). Redeployed.
- App: a duplicate notice shows both images before the tags, with "same garment, skip", "same garment, use this photo"
  (sets the existing item's image) and "different garment".
- Sleeve length: a row in the review and the item editor (tops, layers, outerwear); `normalizeTags` keeps category,
  sleeve "na" and the short_sleeve / short_pants modesty flags consistent with manual edits. Shown on the item page.
- The AI redraw description now starts with the item's current name (brand and the user's own words), plus sleeve length.
- Screens: design/screens/2026-11-10-intake-duplicate.png, 2026-11-10-intake-review-sleeve.png.

## 2026-11-10 - Sleeve and leg length: detect, default short, always choosable
- Tagger: explicit rule for sleeve length (ends above the elbow = short; reaches the wrist, or rolled-up long sleeves =
  long); when the end is hidden it answers short and flags `sleeve` as uncertain. Leg length rule for shorts vs long
  trousers. `uncertain` may now include `sleeve`. intake-tag redeployed.
- App: the sleeve row shows "worth checking" when uncertain; a garment that gains sleeves defaults to short. New
  "leg length" row (long/short) for bottoms in the review and the item editor; short maps to `shorts`, long restores the
  garment's long type (or chinos).

## 2026-11-10 (daily caps)

- Roy hit `daily_limit` mid-upload (80 Google calls in 24 h). Spend was fine: Google $1.55/24 h, $1.76 this month of the $8 cap; Claude $0.19; Modal $0.18.
- Daily caps raised to runaway guards only: detect 200, enhance 60, tag 400, cutout 400. The money guard stays the monthly $8 Google cap in `intake-separate`.
- Deployed: intake-separate v19, intake-cutout v6, intake-tag v7.

## 2026-11-10 (front garment only)

- Cutouts of closet photos kept the shirt hanging behind (BiRefNet keeps every garment it sees). The worker now also runs SAM 2.1 small, prompted with points on the centre of the crop, and keeps BiRefNet's alpha only inside SAM's garment. Guards: if SAM's mask covers under 30% of the foreground it is ignored; pieces under 15% of the biggest are dropped (a second shoe survives). AI redraws skip it (`isolate=0`).
- Tested locally on Roy's 21 photo items: dark and white garments behind are removed; a white shirt with a pink one pressed right behind it can still keep a pink edge (SAM reads them as one).
- Needs `modal deploy worker/app.py` (image grows by CPU torch + SAM; memory 6 GB -> 8 GB). intake-cutout v7 is already deployed and works with the old worker too.
- Fixed: a cutout that finished after "save" never reached the item, so items kept the uncut redraw on white. The app now updates the saved item when a late cutout lands; 17 items fixed in the data.
- Temporary `cutout-backfill` function deployed to re-cut the 21 photo items once the worker is up; retire to 410 after.

## 2026-11-10 (overshirt, type filter)

- New subcategory `overshirt` (category `layer`): a heavier shirt worn open over a T-shirt. The engine can now put it over a tee below the layer threshold (19C) and never on a hot day; laundry after 4 wears. Tagger prompt separates it from `button_down` (thick flannel, corduroy, shacket, chest flap pockets). No DB migration: `items.subcategory` is plain text with no check constraint. Existing button-downs are re-classified by hand with Roy, not by a silent default.
- Deployed: intake-tag v8 (tagger knows overshirt), style-outfit v15 (stylist schema and Hebrew term).
- Wardrobe: a "type" filter row before season/colour: shirts, T-shirts, polos, overshirts, knits, trousers, shorts, shoes, coats, accessories (only types present show). Look at `design/screens/2026-11-10-wardrobe-type-*.png`.
- Re-classified by Roy (2026-11-10): Koton, American Eagle and Grey hooded check flannels are thick overshirts (cotton, 6-20C, transition/winter); Brown Long Sleeve Shirt (olive) is a thin overshirt (16-26C, transition). All `open_front`. Until this PR is live, the deployed app skips these 4 rows as unknown subcategory.

## 2026-11-17 (MCP, phase 1)

- New Edge Function `mcp` (verify_jwt off on purpose, see its header): Fit Check as an MCP server over Streamable HTTP, stateless JSON. Tools: `wardrobe_search`, `item_get` (returns the photo), `item_update` (validated tag merge, hot columns kept in sync), `item_archive`, `item_restore`, `spend_summary`. Service-role client with an explicit `user_id` filter in every query (user-token clients fail inside the Edge runtime, see `_shared/auth.ts`).
- Auth: OAuth 2.1 via Supabase Auth's OAuth server. 401 carries `WWW-Authenticate` -> `/functions/v1/mcp/.well-known/oauth-protected-resource` -> authorization server `/auth/v1`. New consent page `apps/mobile/src/app/oauth/consent.tsx` (outside both route guards; a signed-out user's request survives the Google redirect via session storage, `oauthPending.ts`). Screenshot: `design/screens/2026-11-17-oauth-consent-signed-out.png`.
- Needs from Roy (dashboard): Authentication > OAuth Server: enable, Authorization Path `/oauth/consent`, allow dynamic client registration; Site URL = the production web URL. Then add the connector in claude.ai with `https://ftjerbwrzjprfikxkukj.supabase.co/functions/v1/mcp`.
- Not verified yet with a real OAuth token (the OAuth server is still disabled): if its access tokens carry an audience other than `authenticated`, `authenticate()` will 401 and needs the audience added.
- Phase 2: today's outfit, adding garments from photos, AI redraw and re-cut from chat.

## 2026-11-17 (MCP live, image type fix)

- MCP verified end to end from a Claude session through Roy's claude.ai connector (OAuth token accepted with the existing `authenticated` audience): wardrobe_search (4 overshirts), item_get with photo, spend_summary.
- Fixed: 15 of 144 tag/duplicate calls failed with "specified using image/png but appears to be image/jpeg": some `.png` files hold JPEG bytes. New `_shared/media.ts` sniffs the type from the bytes; used by intake-tag (v9) and mcp (v2). The duplicate check had been silently skipped in those cases.

## 2026-11-17 (wardrobe cleanup, no AI spend)

- Duplicates removed (archived, reversible with item_restore): the older "Polo Ralph Lauren Denim Shirt" and "Tsumi Mandarin Collar" were the same photo saved twice. Checked and kept as different garments: the two white Tommy Hilfiger shirts (pocket vs no pocket) and the Next vs plain white tees.
- 20 images re-cut for free: 19 closet photos re-run through the worker's own BiRefNet + SAM 2 isolation inside Claude's sandbox (Roy, 2026-11-17: do the work locally where it saves paid AI calls), plus the Beige Melange redraw that had kept its white background. Uploaded through a temporary `image-put` function (now 410) as new `N-clean-<ts>-cutout/thumb.png` files; old files untouched. Before/after: `design/screens/2026-11-17-cleanup-before-after.png`.
- Still imperfect (shirt pressed against a same-coloured garment): Gant Button-Down, Grey Hooded Flannel, Tommy Hilfiger Shirt, Abercrombie Button-Down, Brown Zip Jacket. A paid redraw (~$0.034 each) would fix them.
- `cutout-backfill` and `image-put` retired to 410.
- Redrawn with Roy's OK ($0.17 total, 5 x $0.034): Gant Button-Down, Grey Check Flannel Hooded Shirt, Tommy Hilfiger Shirt, Abercrombie Button-Down, Brown Zip Jacket. Descriptions written by Claude from the photos (hood, pocket, logos), so each took one call. Temporary `redraw-five` function retired to 410. Before/after: `design/screens/2026-11-17-redraw-five.png`.

## 2026-11-17 (MCP phase 2)

- New MCP tools: `outfit_today` (the app's engine builds today's candidates with weather, Shabbat/holiday rules, laundry and recent wears; Claude in the chat picks and explains, so the paid Sonnet stylist is skipped), `outfit_log` (worn/skipped/disliked with the app's three writes, pair-weight learning and laundry), `intake_pending` + `item_create` (photos parked with the new "send to Claude" button; Claude tags them itself, no tagger call), `item_redraw` (one paid call, description written by Claude), `item_recut` (free, Modal).
- App: intake screen has "שלח ל-Claude בלי תיוג" under the main button; uploads to `cutouts/{uid}/pending/`. Screenshot: `design/screens/2026-11-17-intake-for-claude.png`.
- The engine runs in Deno through a generated bundle, `supabase/functions/_shared/engine.js` (`scripts/bundle-engine.sh`; re-run after changing packages/engine) with types in `engine.d.ts`.
- The mcp function is deployed as one minified bundle (`scripts/bundle-mcp.sh`), because its sources are too large to paste into the deploy tool.
- `MONTHLY_GOOGLE_BUDGET_USD` and `monthlyGoogleSpend` moved to `_shared/ai/budget.ts`, shared by intake-separate and mcp. intake-separate's deployed v19 already behaves identically; redeploy it with the next real change.

## 2026-11-17 (MCP: several garments in one photo)

- Bug (reported from a Claude session): a pending photo with 6 garments; the first item_create moved the photo away and the second failed with "Object not found", and the cutout covered the whole pile.
- Fix: item_create now copies the photo into the item's own folder, takes an optional `crop` box (fractions 0-1; cropped with imagescript before the cutout, so the item's original, redraw source and re-cut are that garment only) and `keep_pending` (leave it in the queue for its other garments). New tools `intake_dismiss` (drop a pending photo) and `item_recrop` (crop an existing item's original; full photo kept as `N-full-<ts>.jpg`; `requeue_original` puts a copy back in pending; `recut` optional). Single-garment flow unchanged.
- Data: "Zara Half-Zip Sweater" (fa5f2cf6) still has the 6-garment photo as its original; fix with item_recrop (crop box from the photo, `requeue_original: true` to bring the photo back for the other 5).
- Incident (≈20:26–now UTC): mcp v4 returned 500 at boot. Cause: the npm build of imagescript loads a native Node codec the Edge runtime rejects ("unsupported arch/platform"). Fix: the Deno build (https://deno.land/x/imagescript@1.3.0, pure WASM), imported dynamically inside cropImage so a codec problem can only break cropping, never the whole server.

## 2026-11-18 (redraw background)

- An AI redraw's white background is now removed on the server right after generation (`supabase/functions/_shared/whitebg.ts`): a flood fill from the border with a threshold read from the image itself, so white shirts stay whole. Free, no model, about 0.1 s. Wired into `intake-separate` enhance (v20, returns `transparent`) and the MCP `item_redraw` (v6); the Modal worker is only a fallback when the check declines.
- App: `ItemEditor` and `IntakeView` skip the worker cutout when the redraw comes back `transparent`.
- Cause: the Modal workspace was disabled on 2026-11-18, so every redraw stayed on white. 18 items left on white were cleared with the same code; the temporary `image-put` function is retired (410).
- Look at: `design/screens/2026-11-18-redraw-whitebg.png` (all 18 on a green test ground). A faint light outline remains on a few dark garments; it doesn't show on the app's light background.

## 2026-11-18 (AI redraw composer)

- The paid redraw now opens a composer instead of firing right away (Roy, 2026-11-18): the garment as dotted running text where every word is a tag (tap = its closed list, and the change is a tag edit, saved with the new image), detail chips (collar, pockets, logo, closure, soles... 51 in `packages/schema/src/redraw-spec.ts`, Hebrew labels in the locales), photo-fix chips, and up to two free notes of 60 characters. The English prompt is shown read-only, built by the same function the server uses. The button shows the price and the month's remaining Google budget (new `quote` action on intake-separate, no AI call).
- Suggestions cost nothing: the name, brand and detection's description preselect details by keyword (longest match per group), detection's issues preselect fixes (overlapping -> remove the garment behind), and past redraws of the same garment type rank the chips. A free note typed twice for a garment type is offered back as a chip. Logic in `packages/engine/src/redraw.ts`, 19 tests.
- Free notes are cleaned (no quotes, brackets or line breaks), quoted in the prompt, and come with an instruction never to draw them as lettering on the garment.
- Migration `0005_item_redraw_spec.sql`: `items.redraw_spec jsonb`, the last successful redraw's choices, so a second redraw of an item starts where the first ended. Not part of the frozen tags.
- intake-separate `enhance` takes `spec` (the server builds the prompt) or the old `description` (older app builds keep working). A spec with no chips produces the exact pre-composer prompt (test in `redraw-spec.test.ts`).
- MCP `item_redraw`: description is optional; without it, `details` from the same vocabulary build on the item's tags and the spec is stored. `fixes` and `notes` work in both modes.
- `Chip`/`Row` moved from GarmentReview to `features/intake/ChoiceRow.tsx` (shared by intake, item editor and composer). Engine bundle regenerated; it now imports values from @fit-check/schema.
- Deployed: migration 0005 applied; intake-separate v21 (one esbuild bundle, same flags as `scripts/bundle-mcp.sh`), checked to boot. Old app builds keep working (description path).
- mcp v7 deployed later the same day (bundle from `scripts/bundle-mcp.sh`, checked: boots with the same 401 + WWW-Authenticate as before, deployed source identical to the bundle). `item_redraw` chips mode is live.
- Look at: `design/screens/2026-11-18-redraw-composer.png` and `-open.png` (colour word open, a free note being typed, prompt shown).


## 2026-11-18 (design preview, temporary until 2026-11-25T16:00:00Z)

- Read-only design preview of the web app (Roy, 2026-11-18): a designer (another Claude in a real browser) can see Roy's live wardrobe without Google sign-in. Open any URL with `?preview=<code>`; the code goes to sessionStorage and leaves the address bar. Web only, native untouched.
- New Edge Function `design-preview` (verify_jwt off, own check): POST `{ code }`, compared in constant time with the `DESIGN_PREVIEW_CODE` secret (Supabase function secrets only, never in the repo). Returns Roy's rows only (explicit `user_id` filter on every query): items, pair_weights, the last 31 days of wears, stored redraw specs, in the same shapes the app's reads parse. Never writes, never calls an AI provider. 401 for a missing or wrong code, 410 after the expiry hard-coded in the source.
- App: `src/data/preview.ts` (isPreview, getSnapshot kept in memory only); `fetchWardrobe`, `fetchFeedback` and `fetchRedrawHistory` read the snapshot in preview. Every write throws `PreviewReadOnlyError` (screens show their existing "not saved" state), uploads and intake/redraw function calls answer reason `preview`, the stylist returns null (top-scored candidate, no Sonnet call), and the wardrobe is not cached in local storage. SessionState gained `preview`; the signed-in routes render with Roy's id and no Supabase session. A quiet line at the bottom of every screen: "תצוגה לעיצוב בלבד · שום דבר לא נשמר".
- Schema: `packages/schema/src/design-preview.ts` (input and snapshot schemas, 3 tests).
- To remove: retire `design-preview` to a plain 410 (like redraw-five), delete the `DESIGN_PREVIEW_CODE` secret, and revert the preview commits on `claude/busy-tesla-bogylz` (snapshot schema, function, data layer, session/banner, this entry stays).
- Deployed: `design-preview` v1 (one esbuild bundle, same flags as `scripts/bundle-mcp.sh`; deployed source checked against the bundle). Checked: wrong or missing code 401 with no data, OPTIONS preflight returns the CORS headers. Not yet set: the `DESIGN_PREVIEW_CODE` secret (the Supabase tool asks for the value in the dashboard and got no answer), so until it is set every code gets 401 and the preview shows "could not load the wardrobe".
- Look at: on web, `/?preview=<code>`. Checked locally with a mocked snapshot built from the anonymized fixture: Today, wardrobe grid, item page and intake render with the line at the bottom; "לובש", an availability change and every other write sent no request to Supabase and showed the screens' own "not saved" message. Screenshots stay out of the repo (they would show the real wardrobe once the secret is set).

## 2026-11-18 (redesign 1.2: design system foundations)

- Tokens v2 (DESIGN.md section 2): `ink-faint` darkened to #6E6A61 (meta text is darker on every screen, intended), `scrim`, `tile`/`tile-deep`/`tile-cool`, `num-sm`; `motion` gains press/stagger/skeleton, `shadow.lift`/`shadow.sheet` (one `boxShadow` string: RN 0.88 new architecture and react-native-web both take it), `layout` gains grid, nav, desktop and hit sizes plus `masonryColumnsFor()`. Display serif now Frank Ruhl Libre 400 (500 no longer loaded).
- `theme/tileTone.ts`: OKLCH tone rule; bounds L > 0.86 deep, hue 40-110 / L 0.55-0.86 / C 0.02-0.10 cool. Checked on white, cream, beige, khaki, camel, tan, light brown, navy, black, olive, burgundy, blue, grey, yellow, light blue. `tileAspect()` covers all 19 subcategories.
- `components/ui/`: Button, Chip, Segmented, Tile, MasonryGrid (windowed ScrollView, synchronous shortest-column layout), Sheet (RN Modal; desktop dialog >= 900), Swatch, Icon (Material Symbols Rounded 300 paths inline), ScreenHeader, TabBar, TopNav, ListRow, EmptyState, Skeleton, StatusLine, and `Display`/`Meta` (the English-only tracking and uppercase rules live there). Web keyboard focus ring via `data-focusring` in global.css.
- Gallery at `/design-system` (not linked). Screens are not migrated yet.
- Look at: `design/screens/2026-11-18-design-system-*` and `-today-tokens-v2`, `-wardrobe-tokens-v2`.
- Not verified: native iOS/Android (no emulator in the session): Modal + gestures, `boxShadow` on Android, haptics, `I18nManager` RTL.

## 2026-11-18 (redesign 1.3: navigation shell)

- Route group `src/app/(tabs)/` with expo-router `Tabs` and a custom bar (`features/shell/ShellTabBar.tsx`): library `TabBar` below 900px, `TopNav` from 900px, switched on window width. Destinations: wardrobe, today (`/`), add (`/intake`), insights (new), profile (new). URLs unchanged; `/item/[id]` and `/location` stay above the tabs. Tab switches are instant (`animation: "none"`).
- `/profile`: location row (opens `/location`), read-only language row, data credits. `/insights`: empty state pointing at the wardrobe. The old text links between Wardrobe, Intake and Today are removed (Today's own link is left to the Today task).
- Preview banner now sits directly above the tab bar on mobile (root layout only shows it on screens outside the tabs). `TabBar`/`TopNav` got `aria-selected`, which react-native-web did not emit from `accessibilityState`.
- Look at: `design/screens/2026-11-18-shell-*`; resize the browser across 900px; open an item and go back.
- Not verified: native iOS/Android (no emulator): safe-area padding, haptics, RTL tab order.

## 2026-11-18 (redesign 1.4: Today)

- Today rebuilt per DESIGN.md section 3 "היום": masthead (date line, weather line in mono that opens `/location`, place name under it), full-bleed 4:5 flat-lay of cutouts, numbered legend, pull quote, floating action bar ("wearing it" = 1 tap, `tune` opens the adjustments sheet). Tap a garment or its legend row = piece sheet (3 alternatives, swap = 2 taps; "open item"). Swipe on the flat-lay = skip (toward the start edge: left in LTR, right in RTL). Desktop >= 900: two columns, nothing floats. The header link to the wardrobe is gone (the tab bar replaces it).
- New library pieces: `FlatLay` (with the one `FLAT_LAY` placement config; numbers attach to the drawn garment's edge, computed from the photo's aspect), `Stepper`, `LegendRow`, `ActionBar`. Extended: `Button` icon `outlined` (48, beside a button), `StatusLine` `secondaryAction` + `disabled`. Fixed: `Sheet` title hugged the wrong edge for Latin titles in RTL. Gallery shows 8 real flat-lay combinations and the stepper.
- Removed (no other importers): `ActionSheet`, `OutfitComposition`, `ItemPlaceholder`, `editorial/DataStrip`.
- Look at: `design/screens/2026-11-18-today-*` (default at 360/390/430/1280 he+en, piece sheet, adjust sheet, mid-swipe, failed wear, flat-lay combinations).
- Not verified: native (no emulator), real writes (preview is read-only: wear/skip show the failure line), the all-skipped/missing/empty states (not reachable with this wardrobe in preview). Known gap: RNGH 3.3 on web overrides the detector's `touchAction="pan-y"` with `none`, so on a touch browser a vertical scroll that starts on the flat-lay does not scroll.

## 2026-11-18 (redesign 1.4: Today fix round)

- Touch scroll over the hero (web): RNGH 3.3 applies GestureDetector's `touchAction` once, then every gesture config change runs `setGestureConfig()` → `resetConfig()`, which puts `touch-action: none` back. The swipe's pan config now carries `touchAction: "pan-y"` itself (whitelisted at runtime in RNGH's `allowedNativeProps`, missing from `PanGestureConfig`'s type; passed via a variable typed with it, no cast). Verified with iPhone 13 touch emulation: vertical drag from the hero scrolls, horizontal drag swipes.
- `Sheet` ground is `ivory` (was `ivory-deep`), so tiles inside a sheet show their ground.
- Skip line moved out of the floating bar to between the masthead and the hero; the bar is only wear + tune (worn, laundry, failure lines still in it).
- `ActionBar` in Today has `safeArea={false}`: the tab bar below owns the bottom inset.
- Desktop flat-lay capped to the viewport height under the top nav (32 above and below), 4:5 kept by narrowing.
- Look at: `design/screens/2026-11-18-today-{default,piece,adjust}-*.png` (re-shot). Not seen: the skip line on Today itself (the preview cannot record a skip).

## 2026-11-18 (redesign 1.8: small screens on the component library)

- Sign-in is a cover: `Display` app name as the one serif moment, the still life narrowed with air around it, `StatusLine` for a failed sign-in, the Google `Button` (primary) at the bottom. Still-life tiles lost their hairline frames and sit on `tile` / `tile-deep` / `tile-cool` grounds; the garment hexes stay in one commented constant. Monogram label comes from `app.name`.
- Location: back icon button + `ScreenHeader`, `ListRow` choice rows (check + selected state), new `SearchField`, `StatusLine` for the denied message (it used to replace the row's meta). Logic untouched except the search reset is derived instead of set in an effect (lint).
- OAuth consent: `Display` title, scopes as `ListRow`s under a `Meta` label, approve = primary `Button`, deny = outline, errors in `StatusLine`. Logic and redirect handling untouched; the sentence that starts with the client's name now gets an explicit direction.
- `WardrobeGate`: loading is one centred `Meta` line low on ivory; error is `EmptyState` with a retry `Button`. New `+not-found` route (`EmptyState` + back to Today).
- Profile and Insights: new `ScreenColumn`; from 900px the 720 column sits on the start edge of the 1200 container, under the TopNav brand mark. Mobile unchanged.
- `TextAction` / `TextLink` now render the library text `Button` (`quiet` is ignored).
- Library additions: `ListRow` `meta` and `selected`, `SearchField`, `ScreenColumn`. New keys: `common.back`, `common.loadFailedBody`, `oauth.scopesTitle`, `notFound.*`.
- Look at: `design/screens/2026-11-18-{sign-in-idle,location-*,consent-*,gate-*,notfound*,profile,insights}-*.png`.
- Not verified: native, a real Google sign-in, a real consent approval (the ask state was reached with a faked session and mocked Supabase responses), a successful "my current location" write (back has no history in a fresh tab).
## 2026-11-18 (redesign 1.7: Add / intake)

- Add screen rebuilt on the library: `ScreenHeader`, `Segmented` mode, one primary `Button` (choose photos), "send to Claude" as `outline`, `JobCard` (thumbnail + `StatusLine` per photo), `GarmentReview` (large photo on a tile ground from `tileTone`, inline name, library `Chip` rows with an icon-and-words "worth checking" marker, ink save button), duplicate card with two `PhotoTile`s. New library piece `PhotoTile` (tile-style photo with reserved size, skeleton, error glyph); `Tile`'s `FRAME` is exported. Desktop: 720 column, review cards two to a row from 1200.
- Every failure is visible with a reason and, where it can help, "try again": job failures (reason kept: server reason, `http_<status>`, network, preview), failed background removal (original and redraw), late image sync, redraw-spec save, one-garment fallback to the whole photo, tag-corrections write, send-to-Claude failures (retries only the failed photos). Preview blocks read "design preview only: the photo was not uploaded". `busy` is now real (saving, syncing, reading a label).
- Data: `invoke` keeps the server's reason or `http_<status>`; new `reasonOf`; `saveGarment` returns `{ id, correctionSaved }`; `saveRedrawSpec` (data/redraw.ts) returns a boolean.
- Look at: `design/screens/2026-11-18-intake-*`, and the "Add" block of `/design-system`. Not verified: native, and the real upload, detection, tagging, saving pipeline (blocked in the preview).

## 2026-11-18 (redesign 1.5: Wardrobe)

- Wardrobe rebuilt on the library: `ScreenHeader` with count, `tune` (ink dot when a sheet filter is on) and a `backpack` icon for reserve duty; sticky category words (`TextTabs`, new) in DESIGN.md order; colour filter as tappable 24px swatches with the chosen name beside the row; active sheet filters as removable chips; windowed `MasonryGrid` of `Tile`s (2/3/4/5 columns, gap 8, gutter 16); "all" grouped under `Display` headings with counts, one category = continuous grid. Groups now follow the tab order (top, bottom, layer, outerwear, shoes, accessory).
- Filter sheet (type, season, availability; "נקה" / "הצג N פריטים", live). Long press (or Shift+F10 / context-menu key / right click on web, or the screen-reader action) opens the item's actions: availability as `Segmented` (optimistic, same `setAvailability` rules as the item screen), "לפריט" (flight kept), "הסר מהארון" with a confirm step (`archiveItem`). Failures show as `StatusLine`.
- Reserve duty in the grid: tiles toggle with ring + check, usual/all as `Segmented`, reminder under the header, floating `ActionBar` above the tab bar with the count and "סמן כבמילואים" / "ביטול"; away items as a `StatusLine` with the three actions.
- Library (additive): `Button` `dot`; `Tile` `imageRef` + web keyboard/right-click long-press; `MasonryGrid` `StickyHeaderComponent`, `ListSubheaderComponent`, `scrollRef`, `onScroll`; `StatusLine` `moreActions`; `Icon` `backpack`; new `TextTabs`. `Sheet`: the scrim closes only on a press that started on it (a touch long press opened the sheet under the finger and the release click closed it at once).
- Removed (no importers left): `features/wardrobe/{WardrobeGrid,FilterChips}.tsx`, `components/PressScale.tsx`.
- Look at: `design/screens/2026-11-18-wardrobe-*.png`. Not verified: native (no emulator), real writes (preview is read-only; every write shows its failure line), the away block on real data (checked once with a local, uncommitted override).

## 2026-11-18 (redesign 1.6: Item)

- Item screen rebuilt per DESIGN.md section 3 "פריט": hero 56% of the phone screen on its own tile tone, edge to edge, full cutout `contain`ed; `arrow_back` / `more_horiz` as 44 ivory squares on the hero corners (they scroll with it on a phone). Name (display-xl) and brand edit in place (blur/return saves, Escape cancels on web). Availability is the library `Segmented`. Every tag is a chip in a labelled hairline row; a chip opens a `Sheet` with the closed list and saves on choice (seasons: multi-select + done; formality: 1-10 grid). Optimistic: the store changes at once, a failed write rolls back and a `StatusLine` appears under that row. No edit mode, no save button. "Goes with" = up to 3 small flat-lays in a scrolling row, each garment opens its item. Overflow sheet: replace photo, improve with AI (price on the row when quoted), remove (confirm inside the sheet, ink, no accent). Desktop >= 900: two columns, picture held in the start column.
- One save path: `features/item/edit.ts` `editPayload(item, change)` builds the old editor's payload (trim, empty name keeps the old one, empty brand null, `normalizeTags` on a tag patch) and calls the same `updateItemDetails`. `ItemEditor.tsx` removed.
- Replace photo: when background removal fails the uncut photo is still saved, and now a status line says so.
- `RedrawComposer` restyled with library Chip/Button/StatusLine/Meta; new optional props `sheet` (own sheet, paid button + budget pinned in the footer) and `error`. Same logic; long-press on a detail also has a button route (empty "own detail" note offers the chosen details as starting text). Intake's inline use is unchanged in props.
- Shared element (`features/item/transition.ts`, additive): origins carry a tone, a picture rect and `loose`; `registerOrigin` / `flyFrom` / `getFlightOrigin` / `captureReturn` let any picture be an origin. Today's flat-lay ("לפריט" in the piece sheet) and "goes with" garments fly; the ground expands from the origin, the picture scales uniformly; back flies to the pressed garment if still measurable, else fades. Old exports unchanged.
- Library (additive): `Chip` `accessibilityLabel`/`accessibilityHint`/`onLongPress`/`stretch`; `Button` icon `surface`; `FlatLay` `numbered`, `onPieceNode`, exported `flatLayTone`.
- Look at: `design/screens/2026-11-18-item-*` (top/tags/goes-with 390 he+en, bottom, shoes 360, no photo, sheets, rollback, name edit, overflow, remove confirm, composer states, 1280 he+en, flight strips from wardrobe/Today/goes-with and back).
- Not verified: native (no emulator); real writes and the paid redraw (preview blocks them: the failure lines were seen, the success paths were not); price on the button (preview returns no quote).

## 2026-11-18 (polish: sign-in, wardrobe gap, tile tone, lint)

- Sign-in: the Latin app name is in a start-aligned box (same fix as Tile captions and Sheet titles), so it sits on the start edge in he and en.
- Wardrobe "all": the first section heading is now 24 below the visible swatch row (the row is a 44 hit box around 24 swatches, so the spacer is 14); with active-filter chips it stays 24; sections keep 48 between them.
- `tile-cool` #E3E3DD -> #E6E3DC (tokens.base.js, DESIGN.md section 2): less green next to the warm tiles. Beige tee and khaki chinos still read clearly against it (ground moved by 3 on red, 1 on blue).
- Lint clean: the `mounted` flag in the root layout is `useSyncExternalStore` (server false, client true) instead of setState in an effect; the two `i18n` imports are one (kept first); `T[]` instead of `Array<T>`; `i18n.use` goes through the named `use` export.
- Look at: `design/screens/2026-11-18-sign-in-idle-*`, `2026-11-18-wardrobe-all-*`.

## 2026-11-18 (redesign 1.6: Item fix round)

- Shared element: the origin's picture is hidden for the whole flight in both directions and shown again on landing, on an exit without a flight, and when the item screen unmounts (browser back). Hiding goes by the measured node: `components/ui/originVisibility.ts` (`useOriginVisibility`, `setOriginHidden`), wired into `Tile` (`imageRef`) and `FlatLay` (`onPieceNode`; the node now lives inside each garment). `transition.ts` adds `getFlightNode` and re-exports `setOriginHidden`; `captureReturn` now returns `{ origin, node }`. No wardrobe screen change. The page fades out at once on the way back again (the delay only masked the double).
- Back from a deep-linked item (no history) now goes to Today instead of leaving a blank page.
- Availability to spec rows: 32 instead of 48.
- Screen-reader labels and hints on the item screen and in the composer have the bidi isolates stripped (`features/item/a11y.ts` `spoken`); visible text keeps them.
- Look at: `design/screens/2026-11-18-item-flight-*` (re-shot), `-tags-390-*`, `-1280-*`, `-browserback-today-390-he`.

## 2026-11-18 (redesign 1.6: Item, verification fixes)

- Name field: Enter saves and closes on web (the multiline textarea inserted a line break) and on native; a saved name or brand never contains a line break. Brand and name controls: the spoken name starts with the visible text ("הוסף מותג" when empty), and the small brand control is a real 44x44 pressable box on web with no visual change.
- Flight start: the flying picture stays invisible until it has been drawn, then appears in the same frame the origin's picture is hidden (per-frame probe, wardrobe x3, Today x2, goes-with x2: no frame with zero or two copies).
- Reversible picks: colour and leg-length picks are built against the item as the screen opened it (`edit.ts` `colorPatch`, `legPatch`), so jeans -> shorts -> long gives jeans and a colour changed back gets its measured hex, as in the old editor.
- Error lines end with their action: any next edit on the details clears the last failure; "keep" clears the remove failure; closing the composer clears its failure.
- Composer garment words expose `aria-expanded` on web. Library `Chip` has no `expanded` prop yet, so tag chips do not.

## 2026-11-18 - Verification fixes

- Wardrobe: a filter chip applies and closes the sheet (tune + chip = 2 taps); "show N" footer removed; "נקה" in the active-filter row clears colour/type/season/availability in 1 tap and keeps the category. DESIGN.md "ארון" item 7 updated.
- Today: 24px above the masthead and 16px between masthead and hero, so the whole flat-lay clears the action bar at 390x844 and 360x800; credits line sentence case; hero garments out of the Tab order on web (legend rows are the 01..04 stops).
- Reserve duty failure line clears on cancel. `/location` back/choose go to `/profile` when there is no history. Sign-in still life hidden from assistive tech; Monogram uses the 16px token.
- Look at: design/screens/2026-11-18-{today-default,wardrobe-filter-sheet,wardrobe-filters-active,sign-in-idle}-*.png

## 2026-11-18 (redesign 1.7: accessibility fix round)

- State reaches the DOM on web: `webStateProps` in `ui/interaction.ts` maps an accessibility state to `aria-selected` / `-checked` / `-pressed` / `-expanded` / `-disabled` (nothing on native). Used by TextTabs, Swatch, Chip, Segmented (radiogroup + radio), Tile (checkbox), ListRow, TabBar, TopNav, Button. Model: chips and swatches are toggle buttons (`aria-pressed`, also in single-choice rows; a removable chip has none); tabs `aria-selected`; segments `aria-checked`. `Chip` and `Button` take `expanded` for sheet-openers.
- Real 44x44 hit boxes on web (react-native-web ignores `hitSlop`): the Pressable is the 44 box, the 36 chip / 32 ring a centred child; negative margins keep the footprint. Category tabs and TopNav destinations carry their gap as padding (12 / 16 each side) so a short word is still 44 wide; text buttons get `minWidth` 44. Visible sizes and rhythm unchanged (measured). A chip inside a horizontal ScrollView needs 4px of vertical room or the box is clipped back to 36: fixed in intake `ChoiceRow`; the wardrobe active-filter row still needs it.
- Blurred tab screens leave the web tab order and accessibility tree: `features/shell/SceneGate.tsx` (`screenLayout`) marks them `data-scene-hidden`, `visibility: hidden` in `global.css`. State and scroll stay mounted.
- `Display` has `level` (1-3, default 2; `role=heading` + `aria-level` on web); ScreenHeader's title is level 1; Sheet's title is level 2.
- Sheet is one dialog named by its title (`aria-labelledby`, or `aria-label` without a title) on RNW's own Modal element; its two focus sentinels and the scrim are out of the tab order and the tree, Tab / Shift+Tab wrap inside the dialog.
- Look at: wardrobe header rows and the design-system chips / swatches at 390 (should look identical to before); Tab on `/insights` after visiting Today and Wardrobe; the Filter sheet with a screen reader.

## 2026-11-18 - Leftovers

- `FlatLay` takes `pieceFocusable` (default true). False sets `focusable={false}` and `tabIndex={-1}` on the garment buttons (react-native-web renders a `<button>`, which Tab reaches unless `tabIndex` says otherwise); they stay clickable and named. Today passes it (legend rows are the 01..04 stops); the MutationObserver stopgap `useOutOfTabOrder` is deleted. The item screen's "goes with" flat-lays keep their stops.
- Heading levels: `Display` takes `level={null}` for display type that is not a heading (Today's pull quote). Today title, item name, sign-in, consent, not-found titles are level 1 (`EmptyState` takes `level`, default 2); the item name is an h1 around its edit button at rest and a plain labelled field while editing (`InlineText headingLevel`). Gallery masonry category heads are level 3. No more `accessibilityRole="header"` on `Display` (it was overridden by the explicit role on web anyway).
- Wardrobe active-filter chip row: 4px of vertical room in the scroll content and a -4 margin, so a chip's 44 box is no longer clipped to 36 (row and content below did not move). It was the only remaining clipped chip scroller.
- `ListRow` choice rows use `aria-pressed` (not `aria-selected`, invalid on role=button).
- design/screens/after/ and the 360/430 today-default shots re-taken from the final build.
- Look at: Tab on `/` (weather, 4 legend rows, wear, tune); the heading outline per screen; the active-filter chip row at 390.

## 2026-11-18 (redesign stage 1 closed)

- Stage 1 of `docs/REDESIGN_PLAN.md` is complete on `claude/gifted-goldberg-9498c1`: DESIGN.md v2, the component library (`apps/mobile/src/components/ui/`, gallery at `/design-system`), bottom tab bar and desktop top nav, and every existing screen rebuilt on the library. No change to the data model, the Edge Functions or the MCP tools.
- Verified in Chromium on the web build with the read-only design preview, at 390 and 1280, Hebrew and English. Not verified: Android, real writes, the real intake pipeline, the paid redraw, real Google sign-in. `TASKS.md` lists what is open and who can close it.
- Look at: `design/screens/before/` vs `design/screens/after/` (same names), `docs/redesign-checklist-part1.md` and `part2.md` for the regression tables and defects.
- lint went from 20 problems to 0; typecheck and tests pass.

## 2026-11-19 - Intake queue (stage 2, task 2.3)

- The Add screen shows "Waiting for Claude" under the two buttons: the photos sent with "send to Claude" that Claude has not tagged yet, 3 per row on a phone and 6 from 900, each with when it was uploaded (relative for 24 hours, then a short date). Not rendered when the queue is empty. Refreshes on screen focus and after a send batch; no polling.
- `listPendingForClaude` in `data/intake.ts` lists `cutouts/{uid}/pending` with the same folder, extension filter and page size as the MCP's `intake_pending`, newest first. It is a read, so it also runs in the design preview (the bucket is publicly readable).
- Thumbnails are images, not buttons: the bucket has no delete policy, so dismissing stays in the chat (`intake_dismiss`).
- Gallery: loading, one photo, seven photos, failure in the intake block of `/design-system`.
- Look at: `design/screens/2026-11-19-intake-queue-*`; the Hebrew hint line (explicit RTL, it starts with "Claude"); a real send-then-refresh on a signed-in device (not exercised).

## 2026-11-19 - Item: notes, wear history, manual re-cut (stage 2, task 2.2)

- Notes: a "הערות" section after the tags, edited in place like the name (`InlineText multiline`: Enter is a new line, blur saves, Escape cancels on web), 500 characters with a mono counter from 400. Saved through the one payload builder (`editPayload` now carries `notes`; trimmed, empty is null) and the item route's optimistic save, which writes `updateItemNotes` (new, `data/items.ts`) when only the notes changed.
- Wear history: a "לבישות" section after notes: "נלבש N פעמים · לאחרונה ב-<date>" (Hebrew one/two/other forms) or "עוד לא נלבש", five newest wears as hairline rows (numeric date in mono, the outfit's other pieces), "הצג הכול" expands in place. `fetchItemWears` (`data/feedback.ts`): worn wears whose outfit holds the item, all time, newest first, 50 rows, exact count. The design preview derives it from the snapshot, i.e. only the last 31 days. The preview has no worn outfit, so the rows are shown with a fixture in `/design-system` ("מסך פריט: לבישות").
- Manual re-cut: "חיתוך רקע מחדש" in the item's overflow sheet when the item has a source crop; the same free intake-cutout call as "replace photo", on that crop. Busy line under the hero, the hero updates on success, a failure line with the reason (and "נסה שוב" when retrying can help).
- Not verified: native; real notes writes, the real history query with data (only its syntax against PostgREST, as anon) and a real re-cut, all blocked in the preview.
- Look at: `design/screens/2026-11-19-item-*.png`.
