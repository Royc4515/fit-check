# Redesign re-verification (after the fixes)

Verifier: independent, no app code edited. Build under test: the static build served on :4173 (current branch, stage 2 merged), read-only preview. Chromium via Playwright, he-IL and en-US, 360x800, 390x844, 899/900, 1280. The container restarted mid-run; every check below was run (or re-run) on the restarted build. Scripts and screenshots: scratchpad `recheck/` (not in the repo). Spec read from the current `DESIGN.md`.

Flight method: a `requestAnimationFrame` sampler recorded, per frame, the effective opacity (product over ancestors, `visibility` and `display` included) of the origin picture and of the item hero picture of the same garment. "Zero copies" = both below 0.02; "two copies" = both above 0.02. Visual confirmation with CDP screencast frames.

## Summary

31 rows from the two earlier checklists (part 1: 3 FAIL rows + D1-D16; part 2: D1-D13 without D11, which that file itself marked "not a defect"; the part-2 summary says "FAIL 2" but no table row is marked FAIL, so the part-2 defects are the list).

| Status | Count |
|---|---|
| FIXED | 20 |
| NOT FIXED | 4 |
| PARTLY | 2 |
| ACCEPTED (spec now says so) | 4 |
| NOT RE-TESTABLE | 1 |

New findings: 0 blockers, 5 major, 6 minor (section "New findings"). The most important one (N1) is a regression introduced by the hidden-tab fix.

## A. Re-test table

| Id | Original finding | What was done | Re-test and output | Status |
|---|---|---|---|---|
| P1-W4 | Type filter 3 taps (tune, chip, close) | bc102af: chip applies and closes; DESIGN.md updated | Wardrobe he/en 390, en 1280: `tune` click then one chip tap: dialogs 1 -> 0, count changes, focus returns to the tune button. 2 taps. Tab-focusing chips through all 18 stops left the sheet open (dialogs 1); closes only on activation (Enter/click). | ACCEPTED. DESIGN.md line 131: "סינון לפי סוג או עונה = `tune` + chip, 2 הקשות" |
| P1-W5 | Season filter 3 taps | same | same sheet, season chips are in it | ACCEPTED (same line) |
| P1-W7 | Clear all needs 3-5 taps | bc102af: "Clear" in the active-filter row | Active row shows `Remove Shirts` + `Clear`; one tap on `Clear` removes the filter and the button disappears (he/en/1280). Tapping the already-selected chip in the sheet clears and closes. | FIXED |
| P1-D1 | Hidden tab screens stay in the tab order | 692cef0 `SceneGate` (`visibility:hidden` on blurred scenes) | he/en 390, he 1280: after visiting all tabs, Tab sequence on Insights = only visible controls then BODY; focusables in hidden scenes with visibility != hidden: 0 (3 hidden scenes). `elementFromPoint` at 3 points always lands in the visible scene (no click interception). Wardrobe scroll 1200 before/after a 4-tab round trip: 1200/1200; selected category kept. | FIXED (but see N1, N2) |
| P1-D2 | Selected state missing in the DOM | 692cef0 `webStateProps` | Category tabs `aria-selected` (true on `הכל`, false others; true after Enter on another); swatches `aria-pressed` false -> true on click; filter chips `aria-pressed` (false, true after pick); Segmented radios `aria-checked` (item availability, usual/all, long-press sheet, profile language); reserve tiles `role=checkbox aria-checked` false -> true; composer word buttons `aria-expanded` true/false. | FIXED |
| P1-D3 | Filters need more taps than before | see W4/W5/W7 | same | ACCEPTED (spec line 131) |
| P1-D4 | Category tabs 17-41 wide, swatches 32 with no slop | 692cef0 real 44 boxes | Tabs 47/64/71/63/64/59/69 x 44 (he), 44-99 x 44 (en); swatches 44x44 with a 24x24 visual; a click 3px inside the 44 box but outside the 24 visual toggled the swatch (he/en 390, he 360, he 1280). Row y unchanged before/after toggling (158). | FIXED |
| P1-D5 | Desktop top-nav tabs 23-61 wide | 692cef0 | 1280 he: 55x64, 57x64, 71x64, 71x64 | FIXED |
| P1-D6 | Two `role=dialog` nodes | 692cef0 | Filter, tag, composer, piece, adjustment, overflow, sign-out sheets: `[role=dialog]` count 1, `aria-modal` host only, named via `aria-labelledby` -> sheet title; 0 unnamed focusable sentinels. | FIXED |
| P1-D7 | Every Display is an h1 | 692cef0/a6a8731 `level` prop | Heading dump (he/en, 390/1280): Today `L1 היום`; Wardrobe `L1 ארון | L2 <category groups>`; Insights `L1 | L2 | L3 | L2`; Profile L1; Intake L1; Archive L1; Item `L1 <name> | L2 notes | L2 wears`; sheet titles h2. Exactly one level 1 per screen, including 360 he for item, intake, location, profile, insights, archive. | FIXED |
| P1-D8 | Today tab order follows paint order, 8 stops | 692cef0/a6a8731 `pieceFocusable=false` | Tab sequence: weather > 01 Polo > 02 Trousers > 03 Sneakers > 04 Overshirt > wear > tune > bar (he/en, 390/360). Hero garments `tabindex=-1`, still named (`aria-label`), group named. Mouse click on a free point of every hero garment (incl. the layer) opened the piece sheet (390, 360, 1280, he/en). | FIXED |
| P1-D9 | Tab labels Plex Sans, spec said Plex Mono | spec edited | Label font `IBMPlexSansHebrew_400Regular` 12px. DESIGN.md line 102: "תווית בגודל `num-sm` בגופן הגוף (ל-Plex Mono אין אותיות עבריות)" | ACCEPTED |
| P1-D10 | Profile/Insights desktop: 720 column pinned to the start edge | none | 1280: content spans x 500-1220 (he) and 60-780 (en) of 1280; the other ~560px empty. DESIGN.md line 104 still says content centred up to 1200. | NOT FIXED |
| P1-D11 | Reserve failure line stays after Cancel | bc102af | he/en: pick tile, confirm -> `השינוי לא נשמר` shown; Cancel -> gone (false). | FIXED |
| P1-D12 | Hero's bottom 13/20px under the action bar | bc102af | 390x844: hero bottom 669, bar top 679 (10px clear). 360x800: hero bottom 631, bar top 635 (4px clear). See N8 for 899. | FIXED |
| P1-D13 | 4-piece top 50%, layer offset ~10%/8% | spec edited to 50% | Polo box 195/390 = 50% (spec: "50% בארבעה"). Layer unchanged: layer box starts 10.3% of surface width past the top box edge and 7.9% higher (= 20% / 16% of the top's width); DESIGN.md line 110 says "בהיסט של 12% ממנו". Config `FlatLay.tsx:51-53` unchanged. | PARTLY: 50% ACCEPTED, layer offset NOT FIXED / spec unchanged |
| P1-D14 | English credits uppercase on Today, sentence case on Profile | bc102af/8e9cf57 | en: Today and Profile both `text-transform: none`, letter-spacing 0.72px. (Hebrew Today credit node not found by my text query; Profile he ok.) | FIXED |
| P1-D15 | Tab after the last control lands on a scroll container with no ring | 692cef0 | Today, Insights, Profile: after the last bar control Tab goes to BODY (leaves the page), no stop on a container. | FIXED |
| P1-D16 | Masonry gaps 7.3-8.8px | 8e9cf57 | Column gaps: 899: 8.04/7.94; 1199: 8.05/7.95/8.05; 1200 and 1280/1440: 8.01; 600/768/900: exactly 8. Within 0.06px (device-pixel rounding). Columns 2/3/3/4/4/5 at 599/600/899/900/1199/1200. | FIXED |
| P2-D1 | Enter in the name adds a newline | 873aee8 | en/he 390, he 360: click name, type, Enter -> field closes, no textarea, no "\n", exactly one failure line (preview rejects), name rolls back. Shift+Enter also closes (a name never carries a break). Escape: no save, no error line. Blur saves. Brand: Enter saves. | FIXED (but see N3) |
| P2-D2 | State not exposed (Chip, Segmented, composer words) | 692cef0 | See P1-D2: item availability radios `aria-checked`; item tag chips `aria-pressed=false`; sheet current value `aria-pressed=true`; composer detail chips `aria-pressed` toggles on Space; word buttons `aria-expanded`. | FIXED |
| P2-D3 | Chips 36 high with no hit slop | 692cef0 44 hit box, 36 face | Item tag chips 45-88 x 44; every sheet/composer chip 44 high; chip face 36 (measured on faces); no layout shift (row pitch unchanged). Composer garment-word buttons (`Polo`, `White`, `Solid`, `Cotton`, `Short sleeves`) are 32 high and 20-97 wide (en 31.7x32, 41.7x32, 35.9x32, 48x32, 96.6x32; he 25.9x32, 20.6x32, 28x32). | PARTLY: chips fixed, composer word buttons still under 44 |
| P2-D4 | Empty-brand control 62x27, name not in label | 873aee8 | en 65x44, he 62x44; accessible name = visible text (`Add brand`, `הוסף מותג`); click 3px inside the top of the box opens the editor. | FIXED |
| P2-D5 | One blank frame at the start of the wardrobe flight | 873aee8/451bda8 | NOT fixed: forward flight from the wardrobe shows 2-3 frames with no garment (en 390: t=496, 520, 530ms; he 360; 1280: 2 frames), 3 warm rounds each 2 frames; Today forward 2 frames (he/en, 390/1280). Cause: the whole origin scene turns `visibility:hidden` at the tap, ~300ms (cold) before the copy shows. CDP screencast frame shows an empty beige ground travelling. Back flights: 0 zero-copy, 0 two-copy. Goes-with forward/back: 0 / 0. Two-copy frames: 0 everywhere. | NOT FIXED (worse in effect: see N1) |
| P2-D6 | Chips with long press have no hint on web | none | Composer detail chip attributes: `aria-label, aria-pressed, role, tabindex`; no `aria-description`/hint. The `+ Other…` button route exists. | NOT FIXED |
| P2-D7 | Unnamed focusable div + unnamed dialog | 692cef0 | No unnamed stop in any sheet Tab sequence; 0 sentinels. | FIXED |
| P2-D8 | Sign-in unnamed imgs; monogram off scale | bc102af | Signed out he 390: one `img` named `Fit Check`, three SVG `aria-hidden`; monogram 16px (body); one h1; button 350x48; no contrast failures. | FIXED |
| P2-D9 | Deep-linked `/location` back does nothing | bc102af | Deep link `/location` then Back -> `/profile`. From Today: `/location` then Back -> `/`. Works; the fallback is Profile, not Today. | FIXED |
| P2-D10 | Stale error line after an unrelated cancel (item) | 873aee8 scoped lines, `moveOn` | After a failed name save: Escape on a new edit -> 0 error lines; opening each tag sheet clears the previous line; at most one line at a time, text appears for the right field. | FIXED |
| P2-D12 | Short-then-long leg / colour reversal loses the original | 873aee8 baseline | Ran `edit.ts` with tsx on a real jeans item: jeans -> shorts -> long = `jeans`; light_blue -> navy -> light_blue = `#9FC3DB` (the measured hex). UI path not testable: the preview rejects writes and rolls back. | NOT RE-TESTABLE end to end (function level passes) |
| P2-D13 | DESIGN §3 lists temperature as an editable chip, build is text | none | Item screen has no temperature chip (read-only `range` row); DESIGN.md line 139 still lists "טמפרטורה" among the chips. | NOT FIXED (spec and build still disagree) |

P2-D11 (preview shows no retry on job cards) was noted by part 2 as "not a defect"; not re-tested.

## B. Specific checks

**English item flows.** Tag chip sheets for Type, Colour, Pattern, Material, Sleeve, Fit, Seasons, Formality (en 390 and he 360): correct titles and selected value (`aria-pressed=true`), no control under 44, no text under 4.5. Optimistic change and rollback (MutationObserver, preview rejects locally): chip shows the new value at ~24-63ms, old value 8-15ms later, error line 6-15ms after that (e.g. `Pattern: Stripes` 36ms, `Solid` 46ms, error 54ms). The error line text is the scoped `That didn't save, so it's back`. Seasons toggled twice each never left zero selected. Focus returns to the opener chip after pick and after Escape. Overflow sheet (en 390, he 360, en 1280): 4 rows 52 high, Tab cycles inside, Escape returns focus to `More actions`. Composer: opens from `Improve with AI`, word list opens in place (`aria-expanded` true), detail chips toggle with Space, mouse hold 800ms opens the note field (focus `Your own detail`), Enter adds `chest pockethello` as a chip; `+ Other…` adds a second note. See N4 for the focus problem.

**Flights** (wardrobe, Today, goes-with; forward and back; he and en; 390 and 1280). Dense sampling at ~60fps. Forward from wardrobe and from Today: 2-3 zero-copy frames (see P2-D5, N1). Back: no zero, no two. Goes-with (Abercrombie -> Light Blue Jeans): none. No frame with two visible copies anywhere. Hero rect travels 28,511 -> 48,48 over ~420ms.

**360x800 Hebrew** (item, intake, location, profile, insights, archive): no horizontal overflow (scrollWidth 360), one h1, no contrast failure, no control under 44 except the location search field (288x43, N7). Item chips 45-59 x 44.

**899/900.** 899: bottom bar (56), Today hero 560x700 centred at x=170, radius 0; item hero 899x448 full width, name below. 900: top nav (64), Today two columns (hero 386x483 radius 6 at the start side, button 330 wide in the text column), item hero held in its column (394x493) with the details beside. No horizontal scroll at either. Live resize with the item tag sheet open (1000 -> 899 -> 700 -> 1000): still one dialog, focus stays inside, the sheet moves between the centred dialog and the bottom sheet, Escape closes it.

**Sheets (contents).** Today adjustments, piece sheet, filter sheet, long-press sheet (Shift+F10 and touch), item tag sheet, overflow, composer, at he 390/360, en 390/1280: hit boxes all >= 44 (exception: composer word buttons, P2-D3), 0 contrast failures (the disabled `Clear` at opacity .4 is exempt: `aria-disabled=true`, tabindex -1), tab order stays inside the dialog and wraps, chip face 36, Escape returns focus to the opener (tune, piece row, tile, filter, more, sign-out). The long-press sheet radios have `aria-checked`.

**Slow failing write.** The preview throws `PreviewReadOnlyError` before any request (no network call), so a delayed rejection cannot be produced. See "Race risks by code reading".

**Touch long press** (CDP `Input.dispatchTouchEvent`, he and en, 390): hold 900ms opens the actions sheet (4 availability radios, open item, remove) and does not navigate; a 60ms tap opens the item; a slow scroll starting on a tile (1s, 165px of scroll) opens nothing; 4px jitter during a hold still opens it; hold 650ms then drag 60px opens it (the hold already fired, no scroll).

**Reduced motion** (`reducedMotion: reduce`, he and en): Today adjustments sheet and wardrobe filter sheet: 1 position instead of 39 and no opacity states beyond 1; swipe on the flat-lay: 1 position instead of 22, 1 transform instead of 33 (no finger-follow); wardrobe entrance: tile opacity jumps 0 -> 1 (2 states instead of 11-12); item flight: hero rect constant (1 rect instead of 25), opacity only.

**Keyboard-only walkthrough (he, 390).** Works: Tab reaches wear, tune, legend rows; the tune sheet opens, steppers operate, Escape returns focus to the tune button; legend row -> piece sheet -> Escape returns to the row; categories (Enter selects, `aria-selected` follows), swatches (Enter toggles), filter sheet (Tab onto a chip does not close; Enter on a chip applies, closes, focus to the filter button), tile + Shift+F10 opens the sheet and Escape returns to the tile, tile Enter opens the item, chip -> pick -> focus returns to the chip, overflow -> Escape returns to `More actions`, add mode/buttons reachable, profile sign-out sheet -> Escape returns to the button. Every stop had a visible ring (2px outline). Where it breaks: N2, N3, N4, N5, N8 below.

## C. Regression checks for the fixes

- Hit-box layout: chip rows keep their 53px pitch on the item screen; filter-sheet chip tops 44 apart inside a group; swatch row y unchanged on toggle (158); brand control 44 with -8 margin: the text sits where it did.
- Hidden scenes keep scroll and state (1200 -> 1200; selected category kept) and do not intercept clicks (3/3 points resolve to the visible scene). They do, however, hide the screen under the item modal (N1).
- Heading dump: one h1 per screen everywhere (A, P1-D7).
- Filter sheet apply-and-close: Tab-focusing all 18 stops, dialogs stayed 1; closes only on activation.
- Flat-lay on Today: all four garments clickable (free point found and clicked on the layer too), named, `tabindex=-1`.

## New findings

**N1 (major). The hidden-scene fix removes the screen under the item modal at the tap.** `SceneGate.tsx:26-29` uses `useIsFocused()`; when the item route (a transparent modal above the tabs) is pushed, the tab scene is no longer focused and gets `data-scene-hidden` (`global.css`, `visibility:hidden`) at once (measured: grid hidden 29-42ms after pointerdown; copy visible ~300ms later on a cold route). DESIGN.md section 5 says the ivory page fades over the screen underneath ("השאר fade"). Result: the whole wardrobe/Today vanishes at the tap, the flying ground travels over an empty ivory page, the origin tile is gone before the copy is painted (the 2-3 zero-copy frames of P2-D5), and on the way back the grid pops in at the landing frame. Evidence: screencast montages `recheck/montage-fwd.png`, `recheck/montage-back.png`; sampler `f6.js` (`oSceneHidden:true` at t=164 while hero absent). Introduced by 692cef0.

**N2 (major). Item screen: invisible tab bar stays in the keyboard order, and Back/More come last.** Opened from a tile, the first five Tab stops are the covered tab bar (Wardrobe, Today, Add, Insights, Profile, all `visibility:visible`, not under inert), then the name; Back and More are after the details in the DOM. Enter on a hidden tab navigates away under the page. `ItemView.tsx:184-198` (buttons rendered after the details), `app/(tabs)/_layout.tsx` (bar not hidden when the item route is on top).

**N3 (major). Focus is lost to BODY after committing or cancelling an inline edit, after Back, and after wear.** Name: Enter -> BODY, Escape -> BODY. Back (keyboard) from the item -> BODY on the wardrobe, not the tile. Wear (Enter) -> BODY (the button is replaced/disabled). Archive row -> BODY (expected on navigation, listed for completeness). `InlineText.tsx:95-101` unmounts the field and never refocuses the button; `useItemFlight.ts:close`; `TodayView.tsx` action bar.

**N4 (major). Composer: focus leaves the open dialog after a note is added, and Escape lands on a page container.** After adding a note with Enter, `document.activeElement` is the page content (text `Benetton PoloUnited Color...`) while the dialog is still open (dialogs 1). Escape with a word list open closes the whole composer and focus goes to that same container, not to `More actions` (the opener row no longer exists). `RedrawComposer.tsx` (note field unmount), `Sheet.tsx` focus restore.

**N5 (major). Segmented radios do not respond to Space and have no arrow-key movement.** Profile language: Space on `English` did nothing; Enter switched it. Same component for item availability, usual/all, filter facets. `Segmented.tsx` (role=radio handles Enter only).

**N6 (minor). Dialog host takes the first focus with a full-viewport focus ring.** Opening any sheet by keyboard puts focus on the `div[role=dialog]` (390x844, ring=true) before the first control. `Sheet.tsx`.

**N7 (minor). Text fields 43 high.** Location search 288x43 (360 he); wardrobe search at 1280 248x43 (stage 2). Likely the 1px border inside a 44 target.

**N8 (minor). At 899x800 the Today hero is 560x700, so at scroll 0 its lower 246px sit under the floating bar (hero bottom 881, bar top 635).** The bar clearing was only fixed for phone widths. Not checked after scrolling. `TodayView.tsx` hero sizing.

**N9 (minor). Category tabs are individual Tab stops with no arrow-key roving**, unlike the ARIA tab pattern (Enter does select). `TextTabs.tsx`.

**N10 (minor). The Today failure line persists after opening and closing an unrelated sheet** (wear fails; tune open/close; piece sheet open/close: still shown). `TodayView.tsx` status line state.

**N11 (minor). Hebrew Today credits line not found in the DOM by text query** (en present on both screens); not investigated further.

## Race risks by code reading

1. `app/item/[id].tsx:60-69` `changeAvailability`: the catch does `set(prev)` unconditionally. Two quick picks A->B->C where the first write fails after the second succeeded: the UI is set back to A while the server has C. The tag/name path guards against this (line 40); availability does not.
2. `app/item/[id].tsx:27-47` `save`: the rollback is skipped when any field differs from the failed edit's optimistic values (line 40-45). A failed pattern edit followed by a successful name edit leaves the failed pattern displayed (never reverted), while `ItemDetails.tsx:71-73` still shows the failure line for the pattern: error shown, value not rolled back. Also the later write sends the whole payload (`updateItemDetails(itemId, e)` with `e.tags` built from the item that already contains the failed optimistic tag), so the server can receive the value the user was told had failed.
3. `app/item/[id].tsx:28`: `before` is read from the render closure's `wardrobe.items`. Two edits fired before a re-render both use the original item as `before`; a rollback of the second then restores the stale original, undoing a first edit that succeeded.
4. `ItemDetails.tsx:71-73`: the `.catch` calls `setFailure` on a component that may have unmounted (back pressed right after an edit). The store rollback still happens, but the error line is lost: the user leaves believing it saved.
5. `data/useFeedback.ts:135-146` `run`: one shared `busy`/`failed` pair. Overlapping runs (swipe skip is not gated by the bar buttons' `disabled`) let the first `finally` clear `busy` while the second is in flight, and the second's `setFailed(false)` erases the first's failure.
6. `data/useFeedback.ts:159`: the comment says a failed learning step must not fail the wear, but `await learn(...)` is not caught, so a `savePairWeights` failure reaches `run`'s catch: `failed` is set (the bar says it did not save) after the wear was stored and `history` updated.
7. `data/useFeedback.ts:102-109` `learn`: updates are computed from `weights.current` before the `await savePairWeights`, and applied after. Two overlapping learns (wear then dislike) start from the same map and the second write can overwrite the first.

## Not verified

- Native Android and iOS (no emulator): haptics, native gestures, safe-area insets, `I18nManager` RTL, hit slop on native, hardware back.
- Real writes: wear, skip, undo, availability, tag/name/notes save, archive, restore, image replace, paid redraw. The preview rejects them all, so success paths, a slow failing write, and the race risks above are by code reading only. P2-D12 only at function level.
- Real screen readers (VoiceOver, TalkBack, NVDA): only the Chromium DOM/ARIA tree and focus behaviour.
- Firefox, Safari, mobile Safari, the hosted Vercel build.
- Real Google sign-in and consent approve/deny; intake fixture states (job cards, review card, duplicates); upload, detection, tagging.
- Weather: the API was rate-limited, so Today showed the weather line in one state only.
- Stage 2 features beyond what touched the fixes (search, archive, notes, wear history, queue, insights, profile).
- Flight frames were sampled in DOM (opacity, visibility) with CDP screencast for confirmation; a pixel-exact per-frame render capture was not made.
- Drag-to-close and 30%/velocity thresholds of sheets; 120ms press scale; 280ms layout move.
