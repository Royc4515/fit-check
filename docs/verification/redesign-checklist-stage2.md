# Stage 2 verification checklist

Verifier: independent, did not write the code. Branch `claude/gifted-goldberg-9498c1`, stage 2 = `3a13965..HEAD` (build in `apps/mobile/dist` is from merge `2e74b78`; later commit is docs only). Run: Playwright/Chromium against http://localhost:4173, 390x844 and 1280x800, he-IL and en-US, read-only preview snapshot (86 items: 82 active, 4 archived; 1 `skipped` wear, no `worn`). Populated states were produced by rewriting the snapshot response (`page.route`) and mocking the storage list; all of these are marked "mock". No write reached the backend, nothing was uploaded to or deleted from storage. Scripts and screenshots: `/tmp/claude-0/-home-user-fit-check/ca5e7b56-d652-5261-9be8-910a4d6c90db/scratchpad/verify-s2/`.

Result keys: PASS / PASS-UI-ONLY (control works, write blocked) / FIXTURE-ONLY / CODE-READ-ONLY / FAIL.

## Summary

- Checks: 96. PASS 62, PASS-UI-ONLY 8, FIXTURE-ONLY 6, CODE-READ-ONLY 8, FAIL 12.
- Defects: 0 blocker, 6 major, 14 minor.
- No console error or page error on any screen except the expected rejected preview writes and weather/Hebcal failures.

## 1. Search

| Check | Result |
|---|---|
| Substring on name OR brand, case-insensitive, trimmed: 23 queries x 3 contexts, counts vs my own expected counts from the snapshot (`gant`, ` GANT `, `zara`, `t-shirt`, `a`, `levi's`, full-width `ＧＡＮＴ`, `H&M`, `gant  button`) | PASS (0 mismatches) |
| Hebrew name/brand match, final forms (mock: renamed items) | PASS |
| ASCII apostrophe vs Hebrew geresh (`צ'ינו` vs `צ׳ינו`), accents (`ecole` vs `ÉCOLE`) | FAIL (D12) |
| AND with category tab, colour swatch (`t-shirt`+tops 23, +white 7, +bottoms 0), sheet filter (`shabbat`+`zara` = 4) | PASS |
| Count follows (live region `aria-live=polite`, header count on desktop) | PASS |
| Close, Escape clear and restore title (390); Escape and clear button (1280); field stays | PASS |
| Desktop field always visible, wrapper 280 wide, stays 280 when the clear button appears | PASS |
| No-match state quotes the query (isolated), filtered variant | PASS |
| Two "נקה" buttons with different actions in the empty state | FAIL (D10) |
| Grid stays windowed: 23 hits -> 14 tiles mounted, 62 hits -> 13 | PASS |
| No entrance replay while typing (opacity 1 at every sample) | PASS |
| Metacharacters `( * \ [ .*`, emoji, 500 and 1,000 chars, whitespace only | PASS (no crash, correct counts) |
| Heading while search open on mobile | FAIL (D8: no h1) |
| Input hit height | FAIL (D14: 43px) |

## 2. Filters

| Check | Result |
|---|---|
| "לשבת" set vs my reimplementation of `context.ts`/`config.ts`/`filters.ts` rules: 32 of 82, diffed by name, 0 missing, 0 extra | PASS |
| Semantics of "לשבת" for items with no slot (coat, jackets, caps all pass) | FAIL (D4) |
| Formality buckets 1-4 / 5-7 / 8-10: 43 / 34 / 5, all three languages/viewports | PASS |
| Single-select per row (formal replaces mid), AND across rows (mid+shabbat 22, formal+shabbat 5) | PASS |
| Tap applies and closes; taps from wardrobe = 2 | PASS |
| Tapping the selected chip clears (back to 32); chips in active row; "נקה" clears all (82) | PASS |
| `aria-pressed` reflects selected in sheet | PASS |

## 3. Archive

| Check | Result |
|---|---|
| `/archive` lists exactly the 4 archived items (all viewports/languages) | PASS |
| Sheet title = item name, ink button "שחזר לארון" | PASS |
| Restore: tile leaves, then rolled back, error line shown (he/en). The optimistic frame is never painted because the preview rejects synchronously | PASS-UI-ONLY |
| Back without history -> `/profile`; with history -> back | PASS |
| Profile row reachable, count 4 = list length 4 | PASS |
| Empty state (mock: no archived rows): title, body, count 0 | PASS |
| Undo line after removal, failure path: removal fails in the sheet ("ההסרה לא נשמרה"), no undo line | PASS-UI-ONLY |
| Undo line success path (`WardrobeView` `archiveFromSheet` -> `setRemoved`; `undoRemove` -> `useSetItemStatus` rollback + retry line). Logic reads correct: prev status read outside the updater, optimistic then rollback, error line has retry | CODE-READ-ONLY (cannot be exercised here) |
| Undo offered after removal from the item screen | FAIL (D6) |

## 4. Item notes

| Check | Result |
|---|---|
| Item with notes shows them; accessible name "text, הערות, עריכה"; 44px box | PASS |
| Edit -> blur -> rejection -> rollback + scoped line under notes ("השינוי לא נשמר והוחזר...") | PASS-UI-ONLY |
| Enter inserts newline (textarea stays open); Escape cancels and restores | PASS |
| 500 limit (maxlength, fill 600 -> 500); counter hidden at 399, shown at 400 (`400/500`, spoken "400 מתוך 500 תווים") | PASS |
| Empty saves null (`editPayload`: trim, `|| null`; route writes `updateItemNotes`) | CODE-READ-ONLY |
| Name still saves on Enter (field closes, no newline in name, error+rollback in preview) | PASS-UI-ONLY |
| Add-note placeholder on item without notes | PASS |

## 5. Wear history

| Check | Result |
|---|---|
| "עוד לא נלבש" on real items | PASS |
| Fixture states (12 / once / never / loading / failed), rows, "הצג הכול" with `aria-expanded` (5 -> 7 rows) | FIXTURE-ONLY |
| Plurals via i18next with the real locale files: he 1 "פעם אחת", 2 "פעמיים", 3 "3 פעמים", 11 "11 פעמים"; en 1 "Worn once", 2 "Worn 2 times" | PASS |
| Numbers LTR in visible text (isolates), no U+2066-2069 in any accessible name | PASS |
| `fetchItemWears` query | CODE-READ-ONLY, see "Code reads" |

## 6. Re-cut

| Check | Result |
|---|---|
| Row in overflow sheet (he/en/1280), no price, 52px high | PASS |
| Press in preview: line "תצוגה לעיצוב בלבד: הפעולה לא בוצעה", no retry | PASS-UI-ONLY |
| Zero requests (functions/storage/AI) after press | PASS |
| What the re-cut writes for items whose image is a redraw | FAIL (D1, code read + snapshot paths) |

## 7. Intake queue (mock storage list)

| Check | Result |
|---|---|
| Absent when empty (real storage) | PASS |
| 1 and 7 objects: 3 per row at 390 ([3,3,1]), 6 at 1280 ([6,1]), newest first | PASS (mock) |
| Tiles are not buttons (0 interactive), accessible names present (he/en) | PASS (mock) |
| Relative times en ("1 minute ago", "Nov 15"); he | FAIL for he (D3) |
| Failure (500) -> error line with status + "נסה שוב"; retry re-requests (2 calls total) | PASS (mock) |
| Exactly one list request per return to the screen; none during 30 s idle | PASS (mock) |
| Refresh after a "send to Claude" batch | CODE-READ-ONLY (`queue.reload()` after the batch) |
| Request body: prefix `<uid>/pending`, limit 100, sort created_at desc | PASS |

## 8. Insights

| Check | Result |
|---|---|
| Real snapshot: wears empty state (+ "להיום" action) and "עלות ה-AI לא זמינה בתצוגה המקדימה" (he/en/1280) | PASS |
| Mock wears (two outfits same day, skipped, 29 d and 30 d ago): days 3, distinct items 8, most worn Gant Button-Down 3, 4 outfit rows; 29 d in, 30 d out, skipped out | PASS (mock) |
| Strip: 30 squares, filled days exactly {today, -5, -29}; today at the end side (x=20 in he, right in en; he/en/1280) | PASS (mock) |
| Tie-break (equal count -> most recently worn wins) | PASS (mock); same-day ties fall to first piece of newest outfit (D15) |
| Outfit rows, "הצג עוד" (10 -> 12), garment opens item | PASS (mock) |
| Strip is one tab stop with summary label | PASS; focus ring is the browser default, not the 2px ink ring (D11) |
| Most-worn label grammar for count 1 | FAIL (D7) |
| Today boundary (device date vs the date wears are written with) | FAIL (D2) |
| AI cost: bar width = spend/cap (14.9% for 1.19/8, 86.2% for 6.90/8), `aria-valuenow` matches, RTL anchored at start | FIXTURE-ONLY |
| Warn line from 80% (6.90 shows "Close to the cap: $1.10 left"; 1.19 none) | FIXTURE-ONLY |
| Numbers mono, columns end-aligned in both directions | FIXTURE-ONLY |
| Over-cap text, real `ai_calls` read | not exercised (see Not verified) |
| `insights.ts` vs `budget.ts` / `spend_summary` | CODE-READ-ONLY, see "Code reads" |

## 9. Profile

| Check | Result |
|---|---|
| Language switch flips `document.dir`/`lang` with no reload (window marker survives), tab order mirrors (he: ארון rightmost; en: Wardrobe leftmost) | PASS |
| Choice persists across reload (`localStorage fitcheck:language`); switch back works | PASS |
| Text left in the old language after live switch, all four tabs, filter sheet, tile labels | PASS (only the "עברית" segment label, by design) |
| Same after reload on item, `/location`, `/archive`, `/intake`, Today | PASS (only item names, brands, and the credits sentence with proper names) |
| Dates follow language (Today: "ט׳ בכסלו תשפ״ז · יום חמישי, 19 בנובמבר" / "9 Kislev 5787 · Thursday, November 19") | PASS |
| Sign-out sheet: opens, trigger `aria-expanded`, focus trapped, Cancel, Escape, focus returns to trigger (after the close animation), confirm in preview -> `/sign-in`, code forgotten, reload stays on sign-in | PASS-UI-ONLY |
| Signed-in path `signOut.ts` | CODE-READ-ONLY: correct. `scope:'local'`, network error returns `ok:false` and the session stays (supabase-js removes the local session only after a non-error server answer), the route guard handles success |
| Native direction note | not verified |

## 10. Cross-cutting

| Check | Result |
|---|---|
| Forbidden list on new screens (computed styles): shadows at rest (hidden lift layers at opacity 0 only), gradients 0, radius > 8 none, borders around item images none, hex in stage 2 diff 0 | PASS |
| Accent count per screen: wardrobe 0 (also with filter active), archive 0, insights 0, profile 0, item 0, intake 1 (primary button) | PASS |
| Raw pixel values off the 4-scale | FAIL (D13) |
| Physical `left`/`right` text alignment | FAIL (D9) |
| Roles/names in active language; `aria-selected/pressed/expanded` on chips, tabs, segmented (`radio` `aria-checked`), sheet triggers, "show all" | PASS |
| h1 count: 1 on every new screen; h1 absent while mobile search is open | FAIL (D8) |
| Hit boxes >= 44x44 measured: wardrobe, filter sheet, chip row, archive + sheet, profile, sign-out sheet, intake, item | PASS |
| Hit boxes: Insights outfit garments | FAIL (D5: 36x33) |
| Keyboard reachability and ink focus ring on new controls; tab order follows reading order in RTL | PASS (strip group excepted, D11) |
| Contrast computed: ink 15.6, ink-soft 6.45, ink-faint 4.83 (all on ivory), warn 5.28, ok 6.87, accent 9.14; no new text on tile tones | PASS |
| `reducedMotion: 'reduce'`: no errors on wardrobe/profile flows; frame-level animation not distinguishable by my probe | PASS-UI-ONLY (motion itself not verified) |
| i18n: every statically referenced key exists in both locales; only `_two`/`_many` Hebrew plural forms are he-only (correct); dynamic keys covered (`wardrobe.context.*`, `wardrobe.formality.*`, `insights.spend.task.*` has `defaultValue`) | PASS |
| No string literals in JSX in the stage 2 diff (no Hebrew in code; no JSX text literals) | PASS |

## 11. Stage 1 regression smoke

| Check | Result |
|---|---|
| Today loads (he/en/1280), wear button present, 1 tap -> blocked-write line, no write request | PASS-UI-ONLY |
| Garment opens its sheet with alternatives | PASS |
| Wardrobe grid, category tab (shoes 7), swatch, long-press sheet incl. availability and remove | PASS |
| Tile -> item and back to `/wardrobe` with grid restored (flight itself is animation, not measured) | PASS |
| Intake idle (title, choose photos, send to Claude) | PASS |
| Console/page errors: none beyond expected | PASS |

## Defects

### Major

**D1. Re-cut discards the item's current image (81 of 82 items).** `sourceCropPath` strips every suffix, so `.../1-enhanced-<ts>-cutout.png` becomes `.../1.jpg`; the re-cut then writes `.../1-cutout.png` (upsert) from the raw photo and `setImage` repoints the item at it. 81 of 82 active items have an `-enhanced-` path (paid redraw) and one has `-clean-` (hand re-cut); a press silently replaces them with a cutout of the original photo (the raw crop of the archived Clarks shoes shows what that looks like). Nothing says so, no undo. Old file stays in storage, so recoverable only by hand. Evidence: snapshot paths; code. Location: `apps/mobile/src/features/item/ItemActions.tsx:~117-143`, `apps/mobile/src/data/intake.ts` `sourceCropPath` (end of file), `supabase/functions/intake-cutout/index.ts:76-77`. Not exercised (write blocked).

**D2. Insights "today" uses the device date, wears are written with the location-timezone date.** `localDate(new Date())` (`data/insights.ts:28`, used by `loadWorn` in `InsightsView.tsx`) vs Today's `localDate(loc.tz)` (`data/dayContext.ts:38`, default `Asia/Jerusalem`). Evidence: device 2026-11-18 23:15 UTC, Today header says 19 Nov; a worn wear dated 2026-11-19 (mock) -> Insights shows "עוד לא נרשמו לבישות" because `wornFromRows` drops `worn_on > today`. Same mismatch moves the strip window and last square. Hits whenever device tz differs from the saved location tz and in the hours around midnight.

**D3. Hebrew relative times carry stray numerals: "לפני דקה (1)", "לפני שעה (1)", "לפני שעתיים (2)".** `Intl.RelativeTimeFormat('he')` (ICU 78/CLDR 48, reproduced in node) outputs these; shown in tile captions and in the accessible name ("הועלתה לפני שעה (1)"). Location: `apps/mobile/src/features/intake/uploadedLabel.ts` (`rtf.format`). Screenshot: `q-seven-390he.png`.

**D4. "לשבת" includes every outerwear and accessory regardless of formality.** `passesContextRules` returns true when `slotOf` is null (`packages/engine/src/filters.ts:~76`), so 6 of 6 outerwear/accessories pass: Columbia Puffer Jacket (formality 4), Softshell Jacket (3), two caps (2). The stylist never offers them on Shabbat, so the chip and the suggestions disagree for these items, contrary to the code's own claim. Location: `features/wardrobe/filters.ts` `fitsShabbat`.

**D5. Insights outfit garments are touch targets under 44x44.** Shoes and other small pieces in the 120-wide flat-lay measure 36x33 (he and en, 390 and 1280). Location: `features/insights/WearsSection.tsx` `OutfitRow` (`OUTFIT_W`), FlatLay `onPressPiece`.

**D6. No undo after removing from the item screen.** DESIGN.md: "אחרי הסרה מהארון" shows the undo line. Only the long-press sheet sets `removed` (`WardrobeView.tsx` `archiveFromSheet`); item-screen removal (`app/item/[id].tsx:53`, `ItemView onRemoved`) just navigates back. Code read; the write is blocked in the preview.

### Minor

- **D7.** "הנלבש ביותר · 1 פעמים" / "Most worn · 1 times": no plural (the key gets `n`, not `count`). Every tie of a single wear shows it. `locales/*.json insights.wears.mostWornCount`, `WearsSection.tsx`. Screenshot `i3-one.png`.
- **D8.** While search is open on mobile the title row is replaced and the screen has no h1 (0 headings except h2); filter and reserve buttons are unreachable until search is closed (spec-driven, but the heading is not). `WardrobeView.tsx` header.
- **D9.** `textAlign: "left"/"right"` chosen from the language in `WearHistory.tsx:38` (also `InlineText.tsx:84`, pre-existing): CLAUDE.md requires logical properties; on native before a restart the language and layout direction differ.
- **D10.** No-match state: the ink "נקה" clears only the query while the chip row's "נקה" clears the filters; same label, two actions. `WardrobeView.tsx` footer.
- **D11.** The wear strip's single tab stop shows the browser default outline (`auto 1px`), not the 2px ink ring. `WearsSection.tsx` `stripGroupProps`.
- **D12.** Search does not fold the ASCII apostrophe to Hebrew geresh (`צ'ינו` misses `צ׳ינו`) or Latin diacritics (`ecole` misses `ÉCOLE`). `filters.ts` `normalize`.
- **D13.** Off-scale numbers in new code: `OUTFIT_W 120`, `COST_W 88` (and `NUMBER_H 34`, a line-height); big figures use mono at the 28px display size, which is not an `num` step. `WearsSection.tsx`, `SpendSection.tsx`.
- **D14.** Search input is 43px high (259x43 / 248x43), one px under 44. `SearchField.tsx`.
- **D15.** Most-worn ties on the same day resolve by iteration order (first piece of the newest outfit); undocumented. `data/insights.ts summarizeWears`.
- **D16.** "הצג הכול" on the item wears list stops at 50 (`ITEM_WEARS_LIMIT`) while the summary can say more; label claims all.
- **D17.** Spend read: `.limit(20_000)` is silently capped by PostgREST `max_rows` (default 1000, not set in `supabase/config.toml`), so a heavy month undercounts; month boundary is UTC (matches `budget.ts`, differs from the user's local month for the first 2-3 hours); per-task rows are rounded to cents so rows may not sum to the total. `data/insights.ts`.
- **D18.** Stale/untidy: `ProfileView.tsx` comment says `/archive` "is a 404 until that merge"; `data/wardrobe.ts` `type PairRow ={`.
- **D19.** Unworn strip squares are 8px at 390 and the hairline outline is 1.34:1 against ivory (spec-driven, below 3:1 for a state indicator; the state is also spoken).
- **D20.** Third Insights stat at 390 in Hebrew with a Latin item name wraps and left-aligns oddly ("הנלבש ביותר · 3" then "פעמים"). Screenshot `i1-390-he-IL.png`.

Observation outside stage 2: opening a deep path with `?preview=` (e.g. `/wardrobe?preview=...`) lands on sign-in because the guard redirects before the code is read; the root URL works. Preview-only.

## Code reads

**`fetchItemWears` (`data/feedback.ts:~203-255`) vs `0001_init.sql`.** Nothing found that changes the result. Joins: `wears -> outfits!inner -> outfit_items` embedded twice (`outfit_items(item_id)` for the whole outfit, `mine:outfit_items!inner(item_id)` filtered by `outfits.mine.item_id`); the PK (outfit_id, item_id) means no fan-out, so `count: exact` counts wears. `outfits!inner` drops wears whose `outfit_id` was set null (`on delete set null`), consistent with "worn this item". Filter `feedback = 'worn'` matches the enum. Ordering `worn_on desc, created_at desc` is fine (no `id` tie-break). RLS: `own wears`, `own outfits`, and the `exists` policy on `outfit_items` all apply to the embeds. Remarks: it depends on PostgREST resolving the alias in the filter path (the author reports a live 200; I could not re-check against real rows); `breakdown` is selected and unused; `total` falls back to `max(count, rows)`; the list is capped at 50 (D16); in the preview it is the 31-day window, not all time.

**Spend arithmetic (`data/insights.ts` vs `budget.ts` vs `spend_summary`).** The app and the tool both sum `provider = 'google'` this UTC month with null cost as 0 and agree with each other; `budget.ts` sums by two model names (`DETECT_MODEL`, `ENHANCE_MODEL`) across all users with the service role. They agree today only because every Google row uses those two models or the free model with cost 0 (`gemini.ts:170`), and because there is one user (RLS limits the app to its own rows). The cap 8 is repeated in three places. Cap check: app `capLevel` is `>= cap` "over", `>= 0.8*cap` "near"; server refuses at `spent >= cap`: same. Float boundary `8*0.8 = 6.4` compares equal. Month start is UTC in all three, so no disagreement between them, only with the user's local calendar (D17). Row cap and rounding in D17.

## Not verified

Native Android/iOS (direction after restart, haptics, native keyboard Enter/blur behaviour, I18nManager). Any real write: notes, archive, restore, undo-after-removal success, re-cut success, wear logging, sign-out of a real session. Real `wears` rows (live `fetchItemWears`, live Insights read) and real `ai_calls` (over-cap text, real totals, `max_rows` truncation). Real storage listing with content and real thumbnails (only mocked lists with a 1x1 image). Refresh after an actual "send to Claude" upload. Sheet/tile animation frames and the reduced-motion visual result (no errors only). Shared-element flight quality. Today with live weather (rate-limited here). Screen readers (checked ARIA attributes only). Other browsers than Chromium.
