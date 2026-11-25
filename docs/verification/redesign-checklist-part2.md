# Redesign checklist, part 2 (Item, Add, Location, Sign-in, Consent, gate, not-found)

Verifier: independent, 2026-11-18. App code was read-only for me. Build under test: working tree served at localhost:4173, Chromium via Playwright, read-only design preview. Old code read from `origin/main`.
After screenshots: `design/screens/after/2026-11-18-{item,item-lower,item-edit,intake,location,sign-in,consent}-{390,1280}-{he,en}.png` (DSF 2).

## Summary

Regression rows: 47. PASS 22, PASS-UI-ONLY 14, FIXTURE-ONLY 6, NOT-REACHABLE 3, FAIL 2.
Defects: blockers 0, majors 4, minors 9. No capability of the old screens was found missing.

## A. Regression table

Taps counted from the screen named; "old" = old flow with its Save step.

| Capability | Old (taps) | New (taps) | Result |
|---|---|---|---|
| Open item from wardrobe tile | tile (1) | tile (1) | PASS, flight seen |
| Open item from Today | none in old | piece, "לפריט" (2) | PASS, flight seen |
| Open item from "goes with" | none in old (names only) | garment (1) | PASS, flight seen (jeans in Abercrombie outfit 1) |
| Back | text link (1) | arrow (1); deep link falls back to Today | PASS |
| Name edit | Edit, type, Save (3) | name, type, blur (2 + type) | PASS-UI-ONLY. See D1: Enter does not commit |
| Brand edit | Edit, type, Save (3) | brand, type, Enter/blur | PASS-UI-ONLY |
| Empty brand | field | dashed "add brand" text | PASS (but 27px high, D6) |
| Type, colour, pattern, material, fit, sleeve | Edit, chip, Save (3) | chip, value (2) | PASS-UI-ONLY. Sheet titles and list sizes correct (19/16/6/9/4/3). Pattern pick DOM sequence: chip "פסים" at 134ms, rolled back to "חלק" at 143ms, error line at 150ms. Preview rejects synchronously so the optimistic state lives ~9ms |
| Formality 1-10 | chips row | 2x5 chip grid in sheet (2) | PASS-UI-ONLY (code read plus sheet open) |
| Seasons multi-select, min one | toggle chips | sheet toggle plus "סיום" (3) | PASS-UI-ONLY. Clicking every chip twice never left zero seasons |
| Leg length (bottoms only) | row | row; jeans shows "אורך מכנס" with ארוך/קצר; shoes and polo do not | PASS |
| Sleeve row hidden for shoes/bottoms | yes | sneakers: no sleeve row; jeans: none; polo: yes | PASS |
| Material "unknown" | hidden in read, chip in editor | dashed "add material" chip | PASS |
| Temperature range | read-only | read-only text (spec lists a temperature chip; not editable, same as old) | PASS (spec note, D13) |
| Availability (4 states) | radiogroup (1) | segmented (1); preview rollback plus error line seen at 154ms | PASS-UI-ONLY. Selected state not exposed, D2 |
| "Not suggested" note when away | yes | yes | PASS |
| Goes with (3 outfits) | text trios | flat-lay row, scrollable; items without outfits show none | PASS |
| Replace photo | Edit, link (2) | more, row (2); file chooser opens; failure line "החלפת התמונה נכשלה" | PASS-UI-ONLY |
| AI redraw entry | Edit, link (2) | more, row (2); price on row only when quote works (blocked in preview) | PASS-UI-ONLY |
| Remove with confirm | Edit, remove, remove (3) | more, remove, confirm (3); preview failure line shown, sheet stays; "keep" returns | PASS-UI-ONLY |
| Composer: garment words and closed lists | yes | yes (type list opens in place) | PASS |
| Composer: detail chips, "N more" | yes | yes ("עוד 1" expands) | PASS |
| Composer: 6-detail limit notice | yes | not triggered: group exclusivity made the 7th tap a swap on button-down, coat, sweatshirt, jacket, jeans. Code (`tapDetail`) identical to old | NOT-REACHABLE |
| Composer: long-press to note | yes | works (mouse hold 700ms opens note prefilled); plus a button route via "+ אחר…" | PASS |
| Composer: photo-fix chips | yes | yes | PASS |
| Composer: two free notes, counter, limit | yes | counter "16/60" seen, third note blocked with "עד 2 הערות" | PASS |
| Composer: suggestions | yes | yes | PASS |
| Composer: show/hide prompt (English) | yes | yes | PASS |
| Composer: price/budget, disabled when out of budget | yes | no price in preview, budget state not producible. Code identical | NOT-REACHABLE |
| Composer: submit | 1 | 1; blocked with "בתצוגה לעיצוב שום דבר לא נשלח"; no AI/redraw/upload request sent (only design-preview POST) | PASS-UI-ONLY |
| Composer: disabled while a note is edited | yes | yes | PASS |
| Add: modes single/several + tips | two chips | segmented; tips text switches | PASS |
| Add: choose photos (multi) | 1 | 1; file chooser multiple | PASS |
| Add: job card statuses | text | waiting/uploading/separating/cropping/done with count, low-res, skipped in gallery | FIXTURE-ONLY |
| Add: failed job with retry | none | network and http_502 retry; preview and limit without retry (by design) | FIXTURE-ONLY. Live: upload fails with preview line, no retry |
| Add: low-res warning | yes | shown for the 600px JPEG only | PASS |
| Add: send to Claude | yes | preview line; retry only for retryable reasons | PASS-UI-ONLY |
| Add: duplicate card (same / replace / different) | yes | all three actions, plus replaced state | FIXTURE-ONLY |
| Add: review card (type, colour, pattern, material, sleeve, leg, fit, name, unsure marker, label composition, issues) | yes | all present; unsure is icon plus words | FIXTURE-ONLY |
| Add: save / skip / label photo / retake / AI redraw / retry tag | yes | all present | FIXTURE-ONLY |
| Add: seven failure lines | no | cut, sync, redraw cut, spec, wholePhoto, correction, tag error present | FIXTURE-ONLY |
| Add: automatic background removal | on pick | code unchanged (`cut`), now reports `cutError` | NOT-REACHABLE live. Code read |
| Add: "back to wardrobe" link | link | tab bar | PASS (replaced by tabs) |
| Location: default, current, search (≥2 chars, debounced), results, no results, denied, select goes back | yes | all exercised. Geocoder is unreachable from the sandbox; I mocked it with `page.route` (real call: "Failed to fetch"). Denied shows an error line under the list. Select returns to Today (Today, weather, row = 2 taps) | PASS |
| Sign-in | button | idle state fine; Google not attempted | PASS-UI-ONLY |
| Consent: signed-out and missing-id | yes | both states render; approve/deny not reachable | PASS for those two, NOT-REACHABLE for approve/deny |
| Gate: error plus retry, loading | text | error with retry works after unblocking; loading is a quiet line | PASS |
| Not-found page and unknown item id | none / text | page with "חזרה להיום" (works, signed in and out); unknown id shows a line and back | PASS |
| Deep link `/item/<id>` plus reload, back | fade | fade only (one rect, opacity ramp 0.13 to 1); back lands on Today | PASS |
| Reduced motion | n/a | hero never travels, page cross-fades (hero rect constant) | PASS |

### Save payload comparison

Old `ItemEditor` wrote `{name: name.trim() || item.name, brand: brand.trim() || null, tags}` where tags is `item.tags` untouched or `normalizeTags({...cur, ...patch})`. New `edit.ts:editPayload` builds the same name and brand and applies `normalizeTags` to a tag patch; untouched tags are written as stored. For a single-field change the values are identical (colour: same hex rule; leg: `subcategoryForLeg(v, tags, ...)` with the same inputs). Differences:
1. No-op changes are skipped (`editPayload` returns null); old always wrote on Save.
2. Because each pick saves at once, multi-step reversals differ. Old fallback `item.tags.subcategory` and `item.tags.color_hex` referred to the original proposal; new refer to the already-saved value. Example: jeans to shorts, then back to long, gives chinos, not jeans; colour A to B and back to A gives the palette hex, not the measured one. (`TagSheet.tsx` leg case, `edit.ts:colorPatch`.)
3. Redraw saves `editPayload(item, {tags: draftTags})`: same as old.

## B–E. Defects

### Major
- **D1 Enter in the item-name field adds a newline instead of saving** (web). Measured: after Enter the textarea value is `"Zzz Test Name\n"`, field stays open, no save. Code comment claims return saves. Blur saves (trimmed). Brand (single line) saves on Enter. `features/item/InlineText.tsx` (`multiline={display}` with `submitBehavior`).
- **D2 Selected/checked/expanded state not exposed to assistive tech on web** for Chip, Segmented and composer word buttons. Radios have only `role` and `aria-label`; selected season chips have no `aria-selected`/`aria-pressed`; word buttons no `aria-expanded`. RNW does not map `accessibilityState` (the tab bar works around it with `aria-selected`, ListRow too). DESIGN §6 requires state. `components/ui/Chip.tsx:57`, `Segmented.tsx:46`, `RedrawComposer.tsx` word buttons, `Button.tsx`.
- **D3 Chips are 36px tall on web with no hit slop** (45 to 77px wide). `elementFromPoint` 2px outside the chip misses it. All tag chips on the item screen, sheet chips, composer chips. Violates 44 minimum (§2, §6). `Chip.tsx` `hitSlop` is native-only.
- **D4 Empty-brand control is 62x27** (below 44, no slop) and its accessible name "מותג: ריק, עריכה" does not contain the visible text "הוסף מותג". `InlineText.tsx`, `ItemDetails.tsx` addBrand.

### Minor
- D5 One-frame blank origin tile at the start of the wardrobe flight (3 of 3 captured runs): origin picture hidden, copy not yet painted. `useItemFlight.ts` hide at effect time.
- D6 Chip accessible names for long-press hint missing on web (no `aria-description`); button route exists ("+ אחר…"). `Chip.tsx`.
- D7 Sheet adds an unnamed focusable DIV (RNW modal sentinel) and an unnamed outer `dialog`; Tab lands on it. `Sheet.tsx`.
- D8 Sign-in still has three unnamed `img` (still-life) in the tree; Monogram text is 17.6px, off the type scale. `StillLife.tsx`, `Monogram.tsx:17`.
- D9 Deep-linked `/location`: the back arrow does nothing (no history). Same as old. `app/location.tsx` `router.back()`.
- D10 A stale error line persists after an unrelated cancel (name Escape left the earlier pattern failure visible). `ItemDetails.tsx` failure state.
- D11 Preview-only: `preview` failures show no retry on job cards (intended by `FINAL_REASONS`), so the brief's "preview line with a retry" is not the behaviour. Noted, not a defect.
- D12 Short-then-long leg/colour reversal loses the original value (payload difference 2 above).
- D13 DESIGN §3 lists temperature as an editable chip; it is read-only text (as in old). Spec edit or build, undecided.

Checked and fine: hero 473px of 844 (56%), full width, radius 0, no border on images; back/more 44x44 radius 6 on ivory; chip radius 6, height 36; fonts only Frank Ruhl Libre, IBM Plex Sans Hebrew, IBM Plex Mono; no gradients, no radius over 8, no shadow at rest (shadow only on the open sheet), no letter-spacing on Hebrew; text contrast: zero text under 4.5 on all audited screens (390 and 1280, he and en); accent uses: item 0, location 0, intake 1, sign-in 1, consent 1 (the Google button, a non-navigation action); no bidi isolates in any `aria-label`; focus returns to the opener on Escape (chip, more button); focus stays inside open sheets (Shift+Tab 40 times never left); flights: exactly one visible copy per frame in every wardrobe, Today and goes-with run (forward and back), no squashed aspect, origin back at opacity 1 after return, 420ms-ish travel.

## Not verified
- Native Android/iOS (no emulator): haptics, hit slop on native, gestures, hardware back.
- 360x800 Hebrew was not run. English: screenshots and the static audit only; flights, interaction and composer were run in Hebrew only.
- Real writes (rollback seen only because the preview rejects synchronously; a slow failing write was not simulated), real uploads, detection, tagging, background removal, the paid redraw, budget/price states, the 6-detail limit notice.
- Real Google sign-in, consent approve and deny.
- Review-card, duplicate and failure states: fixtures only.
- Long-press on touch hardware; screen-reader announcement (only the DOM and ARIA tree were checked).
- Desktop (1280) interaction beyond screenshots and the static audit; shoes/trousers flights.
