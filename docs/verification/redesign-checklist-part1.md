# Redesign verification, part 1: shell, Today, Wardrobe, Profile, Insights

Verifier: independent, no app code edited. Branch under test: working tree at `3be63ed`, served as a static build on :4173 with the read-only preview. Old behaviour read from `origin/main` (`index.tsx`, `wardrobe.tsx`, `TodayView`, `ActionSheet`, `OutfitComposition`, `WardrobeView`, `WardrobeGrid`, `FilterChips`, `filters.ts`, `_layout.tsx`).
Method: Playwright 1.63 / Chromium, 390x844, 360x800, 1280x800, plus a width sweep 360-1440; Hebrew (`he-IL`) and English (`en-US`); real touch via CDP `Input.dispatchTouchEvent` for swipe and long-press.

## Summary

Regression rows: **31 PASS, 3 PASS-UI-ONLY, 11 NOT-REACHABLE, 3 FAIL** (48 counted rows; W26 is not counted).
No capability was lost. The 3 FAILs are all one thing: the wardrobe filters take more taps than before (spec-mandated filter sheet).

Defects: **0 blockers, 4 major, 12 minor** (section "Defects").

Good news, one line each: no gradients, no shadow at rest (only the allowed bar shadow and a zero-opacity press layer), no radius above 8, no border on any item image, one `accent` use per screen, no letter-spacing on Hebrew, fonts are Frank Ruhl Libre / IBM Plex Sans Hebrew / IBM Plex Mono only, token colours only; masonry column counts, gutters, gaps, tile aspects (1.55 / 1.45 / 1.25 / 1.1 / 1.05 / 0.85) and tile tones all match DESIGN.md; no WCAG text-contrast failure found on any audited screen; every audited control has an accessible name in the active language; tab/deep links/reload work; windowing shows no blank region and no layout shift; scroll position survives tile -> item -> back.

Caveat on evidence: the weather API (Open-Meteo) started returning HTTP 429 mid-session, so the saved "after" screenshots show the "no weather data right now" state. The with-weather state was seen earlier in the session (`16-25°  ·  Rain 0%  ·  Partly cloudy`, correct per spec) but is not in the PNG set.

## A. Regression table

Taps are counted from launch (Today is the launch screen). "old" = origin/main code, "new" = running app.

### Navigation

| # | Capability | Old (taps) | New (taps) | Result |
|---|---|---|---|---|
| N1 | Go between Today / Wardrobe | text link in each header (1) | tab bar / top nav (1) | PASS. URL and exactly one `aria-selected` tab asserted for `/`, `/wardrobe`, `/insights`, `/profile` at 390 and 1280, he and en; reload and deep link on each path land on the right screen with the right tab selected |
| N2 | Wardrobe -> Add clothes | link (1) | centre Add button / top-nav Add (1), opens `/intake`, no destination tab selected | PASS |
| N3 | Open location picker | Today link (1) | weather line on Today (1); also Profile -> Location row (2) | PASS, `/location` reached both ways, back returns to the same tab |

### Today

| # | Capability | Old | New | Result |
|---|---|---|---|---|
| T1 | Title + Hebrew/Gregorian dateline | launch | launch | PASS (`ח׳ בכסלו תשפ״ז · יום רביעי, 18 בנובמבר`) |
| T2 | Shabbat/holiday candle-lighting line | launch | masthead, `TodayView.tsx:325-327` | NOT-REACHABLE: Wednesday, `candleLighting` empty. Checked instead: code path retained, same i18n key `today.candles`, LTR isolate on the time |
| T3 | Day label / holiday name in the explanation | launch | launch | PASS for weekday (`יום חול.`); holiday name path `TodayView.tsx:124` retained, not reachable with this date |
| T4 | Composition of top/bottom/shoes/layer with 01-04 captions | launch | flat-lay + legend rows | PASS (4-piece outfit seen, 3-piece path only by code, `FlatLay.tsx:42-45`) |
| T5 | Swap a garment for an alternative | 4 taps (open sheet, "swap", tap row, tap alternative) | **2 taps** (garment or legend row, then alternative); sheet closes, hero images change | PASS, better than before. Three alternatives shown, labels `החלפה ל…` / `Swap for …` |
| T6 | "No alternatives" line | swap mode | `PieceSheet.tsx:51-53` | NOT-REACHABLE: every piece had 3 alternatives. Code path retained |
| T7 | Wear | 2 (open sheet, wear) | **1** (`לובש` is on the floating bar from launch) | PASS-UI-ONLY: control reacts, preview rejects the write, bar shows `That didn't save. Try again.`, outfit unchanged |
| T8 | Skip | 2 (open sheet, skip) | swipe on the flat-lay (1 gesture) or `tune` -> Skip (2) | PASS-UI-ONLY: both paths run, both end in the failure line; outfit does not change (write blocked) |
| T9 | Warmer / cooler / dressier / more casual | 2 taps for the first, 2 for each next (sheet closed after every action) | `tune` + stepper (2), then 1 per extra tap (sheet stays open) | PASS. Two taps on "Warmer" show `+2`; Hebrew and English |
| T10 | Reset the day's nudges | `Reset` link in status area (1) | `Reset` in the sheet and under the quote (1) | PASS (en: `ADJUSTED FOR TODAY: WARMER ×2` + `Reset`; he: `כוונון להיום: יותר חם ×2` + `איפוס`) |
| T11 | Learned-lean line ("standing lean") | status line | under the quote, `TodayView.tsx:289-300` | NOT-REACHABLE: no history samples in the preview. Code path retained |
| T12 | Worn status + Undo | status line | bar status, `TodayView.tsx:249-257` | NOT-REACHABLE: needs a successful write |
| T13 | Laundry line + "keep home" | status line | `TodayView.tsx:252-264` | NOT-REACHABLE: needs a successful wear |
| T14 | Skipped / disliked status, Dislike, Undo | status line | line above hero, `TodayView.tsx:266-276` | NOT-REACHABLE: needs a successful skip |
| T15 | Failure status | status line | bar line, `TodayView.tsx:277` | PASS (seen after wear, skip, swipe) |
| T16 | Explanation lead + notes | launch | quote under the 1px ink rule | PASS (template text). Stylist-chosen sentence (`styled`) NOT-REACHABLE: no stylist answer in preview |
| T17 | Weather range / rain / sky | strip | masthead line `num` mono | PASS (seen before the 429); no-weather fallback `אין כרגע נתוני מזג אוויר` PASS |
| T18 | Data credits | launch | launch (bottom of page) | PASS |
| T19 | Empty states: all skipped / slots missing + "add clothes" link / nothing | launch | `TodayView.tsx:426-443` | NOT-REACHABLE: wardrobe is full, nothing skipped. Code retained, link goes to `/intake` |
| T20 | Busy state blocks double write | dimmed actions | `disabled={busy}` on bar buttons | NOT-REACHABLE (needs a write in flight) |

### Wardrobe

| # | Capability | Old | New | Result |
|---|---|---|---|---|
| W1 | Title + "N items in M groups" | launch -> link | count only (`82`) | PASS, sentence replaced by the count the spec asks for |
| W2 | Category scope | one grouped list | `All / Tops / … / Accessories` text tabs (1 tap), counts verified: Tops 43, Shoes 7 | PASS |
| W3 | Colour filter | colour chip (1) | swatch (1) + name written beside the row (`Black`); second tap clears | PASS |
| W4 | Type filter | chip row (1) | `tune` + chip + close/"Show N items" (**3**) | **FAIL** (more taps). Behaviour correct: single select, 24 shirts-or-tees counts update live |
| W5 | Season filter | chip (1) | same sheet, 3 | **FAIL** (same cause). AND with type verified (23) |
| W6 | Availability filter | chip, hidden while <2 values | `FilterSheet`, hidden while <2 values | NOT-REACHABLE: every item is `home`, facet correctly absent (Shoes scope also drops `Type`, one value). Code `filters.ts:109` |
| W7 | Clear all filters | `All` chip (1) | `tune` + Clear + close (3) clears sheet facets only; colour and category separately; or remove active chips one by one; or `Clear filters` in the no-match state (1) | **FAIL**: 3-5 taps from a filtered state vs 1 |
| W8 | Active filters shown, removable | selected chips in the row | chip row under the swatches with `close`; removing one updates the count (23 -> 58 after removing the first of two) | PASS |
| W9 | Facets with fewer than two values hidden | yes | yes | PASS |
| W10 | Grouped by category with heading + count | yes | heading `display` + mono count per group under "All"; continuous grid in one category | PASS |
| W11 | Per-group palette strip | 10px swatch strip | replaced by the filter swatch row (spec) | PASS |
| W12 | Tile: name, type · colour | yes | yes | PASS |
| W13 | Away items dimmed + location replaces colour | `where` text, opacity 0.45 | `WardrobeView.tsx:189-199` | NOT-REACHABLE: no item is away/laundry/lent. Code retained |
| W14 | Tap tile -> item with shared element | 1 | 1 (`/item/<id>`), back button 1 | PASS; scroll offset after back = before (2600 -> 2600 at 390 and 1280), also after browser Back |
| W15 | Reserve duty: start | text button (1) | backpack icon button, label `יוצא למילואים` (1) | PASS (`82` -> `27` "usual" items) |
| W16 | Pick hint, picked count, Hebrew plural | yes | `נבחר פריט אחד` / `נבחרו 3 פריטים`; en `3 items picked` | PASS |
| W17 | "Not in wardrobe" reminder | yes | yes | PASS |
| W18 | Usual / whole-wardrobe toggle | text link (1) | segmented (1): 27 <-> 82, picks kept | PASS |
| W19 | Confirm disabled with 0 picks; mark as away | yes | `סמן כבמילואים` / `Mark as away`, disabled with 0 | PASS for disabled; end state PASS-UI-ONLY: failure line `השינוי לא נשמר. נסה שוב.`, picker stays open (correct) |
| W20 | Cancel | link | `ביטול` / `Cancel` | PASS (picker closes, header back to 82) |
| W21 | Away state: count, back to laundry, back home, pack more | header block | `WardrobeView.tsx:282-292` | NOT-REACHABLE: no away items (needs a successful write). Code retained |
| W22 | Reserve failure line | yes | yes | PASS, but see D11 (stays after Cancel) |
| W23 | No-match state | text only | title + body + `Clear filters` / `נקה סינון` (resets category too, 82 back) | PASS, improved |
| W24 | Columns | 3 / 5 | 2 (<=599), 3 (600-899), 4 (900-1199), 5 (>=1200), verified at 360, 390, 599, 600, 768, 899, 900, 1199, 1200, 1280, 1440 | PASS |
| W25 | Whole grid rendered | not virtualised | windowed | PASS: fast wheel scroll through the whole list (24 steps at 390, 13 at 1280), no unfilled region, tiles in DOM max 22 / 35, 0 tiles moved or resized between first paint and after images loaded |
| W26 | Layout move on filter (280ms) | yes | not measured | not in counts, listed under "not verified" |

New (not in old, checked): long-press sheet by touch (800ms hold) and by keyboard (`ContextMenu`, `Shift+F10`) opens the actions sheet; Escape returns focus to the tile; availability radios present; availability change shows failure line (UI-only); Remove needs a second confirm tap.

## B. Spec check (DESIGN.md) - what matched and what did not

Matched (measured): hero 4:5 full-bleed on phone, radius 0 (390 wide: 390x487.5), radius 6 and 515 wide in the desktop start column, ground `#DDD4C3` (tile-deep) because the polo is white; title `display-xl` 40/46 Frank Ruhl 400; dateline 14/22 ink-soft; legend rows 47px with hairlines; quote `display` 28/34 under a 1px ink rule; wear button 294x48 radius 6 accent `#7A1F2B`, `tune` 48x48; floating bar `0 -8px 24px rgba(27,26,23,.08)` + 1px hairline top (the only shadow); tab bar 57px (56 + hairline), `#EDE7DB`, no shadow, Add 48x48 radius 8 raised ~7px, selected tab has `aria-selected` and 2px line; desktop top nav 65px (64 + hairline), brand at start, tabs centred, Add at end; wardrobe gutters 16, gaps 8 (7.3-8.8 at some widths), caption to next tile 16, content capped at 1200; tile radius 6, padding 12, aspect by type, tones `tile` / `tile-deep` / `tile-cool` chosen as specified; sheet radius 8 top only, 32x4-style handle, spring without overshoot (monotonic 1385 -> 541 in ~330ms); Hebrew has `letter-spacing: normal` everywhere; English display -0.4px, meta 0.72px (0.06em) uppercase.

Deviations are in the numbered list below (D9, D10, D12, D13, D14, D18).

## C. RTL / LTR

Hebrew: titles, dateline, legend, tab bar (Wardrobe rightmost), top nav (brand right, Add left), hero composition (top on the right, bottom to its left, shoes right of the trousers), category tabs (start at right, scroll off to the left), swatch row, tune/backpack at the left end, tile captions (Latin names right-aligned to the start edge: `Beige Melange T-Shirt` ends at the column's right edge), Profile row chevron mirrored (points left), sheets (title right, close left, stepper "less" on the right). Numbers are isolated LTR (`⁦82⁩`, `+2`, `01`). English is the mirror image. **No element found on the wrong edge.** Swipe direction mirrors: skip fires on finger left->right in Hebrew, right->left in English.

## D. Interaction checks (scripted)

- Tabs/deep links/reload: pass (N1).
- Today: wear is 1 tap; garment -> sheet -> alternative = 2 taps and the hero swaps; legend row opens the same sheet; adjustments sheet steppers stack (`+2`), reset works, Escape closes (DOM removed after ~700ms), focus returns to the opener (checked for piece sheet and tune button), Tab stays inside an open sheet (cycles through a non-button stop once).
- Swipe with real touch events: he finger left->right and en finger right->left trigger skip (failure line, hero unchanged because the write is blocked); the opposite direction does nothing; a 30px drag returns; a vertical drag starting on the hero scrolled the page (0 -> 392 and 0 -> 408). During a swipe the hero layer follows the finger (-12, -24 … px, 29 distinct frames).
- Wardrobe: all in section A. Single select per facet confirmed (Shirts then T-shirts leaves one selected, count 24), AND across facets (23), remove chip, clear, no-match, reserve flow, long press, scroll restoration, windowing.
- Reduced motion (`reducedMotion: reduce`): Today sheet appears in one frame at its final position (normal: 30 frames), swipe has no finger-follow (2 distinct states vs 29), wardrobe stagger entrance has no intermediate opacity frames (normal: 30). PASS.

## E. Accessibility

Names: every interactive element on Today, Wardrobe, Insights, Profile at 390 and 1280, he and en, has a name; no Hebrew name in English or the reverse (Latin item names inside Hebrew labels are data). Focus ring: 2px `#1B1A17` outline, offset 2, on every stop except the page scroll container that receives focus after the last control (no ring). Contrast: no text under 4.5 (3 for large) on any audited screen; sheets were not included in the automated contrast/hit-target pass.

## Defects

Severity: blocker = capability lost or unusable; major = visible spec violation or a11y failure; minor = polish.

### Major

**D1. Hidden tab screens stay in the tab order.** Visited tabs remain mounted, `aria-hidden`, but their controls are still tabbable. After visiting Today, pressing Tab on Insights walks 11 invisible stops (weather button, 4 garments, 4 legend rows, wear, tune) before reaching the visible "Go to wardrobe"; on Wardrobe/Profile the same (counts 11-58 hidden focusables per screen). Evidence: Tab sequence on `/insights` after Today: `Profile > Today… > Weather… > Overshirt… > … > Wearing it > Adjust > Go to wardrobe`, each flagged `closest('[aria-hidden=true]')`. Likely: `apps/mobile/src/app/(tabs)/_layout.tsx:16-31` (screens kept mounted, no `inert`/`display:none` on blurred scenes).

**D2. Selected / checked state is not in the DOM for most controls.** On web `accessibilityState` is ignored (the author found this and fixed only the tab bar, `TabBar.tsx:31-33`). Measured attributes: category tabs `aria-selected` absent; colour swatches no `aria-pressed/selected`; filter-sheet chips and active-filter chips none; segmented radios (usual/all, availability) no `aria-checked`; reserve-duty tile `role=checkbox` has no `aria-checked` after being picked. A screen-reader user cannot tell which category, colour, filter, mode or picked tile is active. DESIGN.md section 6 requires the state. Code: `TextTabs.tsx:35`, `Swatch.tsx:54`, `Chip.tsx:84`, `Segmented.tsx:45`, `Tile.tsx:217`, `Button.tsx:87`.

**D3. Wardrobe filters need more taps than before.** Type, season, (availability): old 1 tap, new `tune` + chip + close = 3. Clearing everything: old 1 tap (`All`), new 3-5. Spec section 3 "ארון" item 7 defines the sheet, so this is by design, but it is a regression against "needs more taps than before". Code: `WardrobeView.tsx:249-255`, `FilterSheet.tsx`.

**D4. Hit targets under 44 wide.** Click tests confirm the hit area equals the visible box (clicks 3-12px outside did nothing). Category tabs: widths 17 (`All`), 30, 35-41 by 44 high at 390. Colour swatches: 32x32 with nothing around them (spec: "hit 44"; `Swatch.tsx:51` has `hitSlop` but it has no effect on web). Evidence: `getBoundingClientRect` + `elementFromPoint` + click offsets. Code: `TextTabs.tsx`, `Swatch.tsx:31-55`, `SwatchRow.tsx:16`.

### Minor

**D5.** Desktop top-nav tabs are 23-61 wide x 64 (pointer target under 44 wide for `ארון`, `היום`, `Today`, `Profile`). `TopNav.tsx:39`.

**D6.** Sheets expose two `role=dialog` nodes: an unnamed `aria-modal` host (RN Modal) wrapping the named one. `getByRole('dialog')` resolves to 2. `Sheet.tsx:227-230`.

**D7.** Every `Display accessibilityRole="header"` renders `<h1>`: Wardrobe has the screen title plus one h1 per category group; sheets add another. No heading hierarchy. `Type.tsx:32`, `WardrobeView.tsx:224`.

**D8.** Today tab order inside the hero follows paint order (04, 02, 01, 03), not the printed numbers; each garment is reachable twice (hero and legend), 8 stops for 4 garments. `TodayView.tsx:229-236`, `FlatLay.tsx` (`Z_ORDER`).

**D9.** Tab-bar labels use Plex Sans 12px; spec says `num-sm` (Plex Mono) for the tab label. `TabBar.tsx:43`.

**D10.** Desktop Profile and Insights are a 720px column pinned to the start edge (right in Hebrew, left in English), leaving the other ~40% empty; spec: content centred up to 1200. `ScreenColumn.tsx:6,25`.

**D11.** Reserve-duty failure line stays under the header after Cancel (screenshot: `השינוי לא נשמר` visible with picker closed). `WardrobeView.tsx:164-168` (cancel does not clear `failed`), `:293`.

**D12.** At 390x844 the 4:5 hero's bottom 13px sit under the floating bar (20px at 360x800); the shoes stay clear. `TodayView.tsx:533-541` (masthead 205px + hero 487px + bar 73px > viewport).

**D13.** Four-piece outfits: top is 50% of the surface wide (polo box 195/390), spec ~58%; layer offset ~10%/8% instead of 12%. `FlatLay.tsx:51-53`.

**D14.** English credits line is uppercase and tracked on Today (meta default, proper names shouted: `WEATHER: OPEN-METEO · HEBREW CALENDAR: HEBCAL`, `GIV'AT SHMUEL`) but sentence case on Profile (`ProfileView.tsx:47` overrides). Inconsistent; the spec only says meta is uppercase in English.

**D15.** After the last control Tab lands on the page's scroll container with no focus ring (`היום ח׳ בכסלו…` at 0,0).

**D16.** Masonry column gaps are 7.3-8.8px (not exactly 8) at 899, 1199 and 1200 wide; rounding of column x. `MasonryGrid.tsx`.


## Screenshots

Saved to `design/screens/after/2026-11-18-{today,today-sheet,wardrobe,wardrobe-scrolled,insights,profile}-{390,1280}-{he,en}.png` (deviceScaleFactor 2; 24 files). I looked at: today 390 he and 1280 he, today-sheet 390 he and 1280 en, wardrobe 390 he, 1280 en and he, wardrobe-scrolled 390 en, insights 390 he, profile 390 he and 1280 en. Visually off: Today 390, the hero's lower edge disappears behind the bar (D12); Today shows the no-weather line (429); Profile/Insights desktop lopsided (D10). Everything else read cleanly: no clipped text, garments readable on their grounds (white polo on `#DDD4C3`, beige tee on tile-cool), even spacing.

## Not verified

- Native Android/iOS: no emulator. Haptics, native gestures, safe-area insets, `I18nManager` RTL, status-bar overlap with the sticky category row were not exercised.
- Real writes: wear, skip, undo, dislike, keep-home, availability change, mark-as-away, back from away, archive. The preview rejects all of them; only the failure state was seen. The optimistic rollback of a failed availability change was not inspected.
- States this data cannot produce: Shabbat/holiday candle line, items away/in laundry/lent on tiles, away banner, empty Today states, learned lean, stylist-written sentence, "no alternatives".
- Weather with data in the saved screenshots (rate-limited), and any retry/cache behaviour of the weather fetch.
- Desktop nav swap exactly at 899/900px (wardrobe columns were swept; the nav and Today layout were checked at 390, 360 and 1280 only).
- Sheet contents: hit targets, contrast and tab order inside open sheets (filter chips at 36px with hitSlop) were not audited; drag-to-close and 30% / velocity thresholds not tested.
- Shared-element flight visuals, 280ms layout move on filtering, 120ms press scale, 40ms stagger timing (only that stagger exists and is removed under reduced motion).
- Real screen readers (VoiceOver, TalkBack, NVDA): only the Chromium accessibility tree.
- Firefox, Safari, mobile Safari behaviour; hosted Vercel build (only the local static build).
- The temporary preview banner under the content was ignored for spec checks.
