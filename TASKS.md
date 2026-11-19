# TASKS - redesign "Pinterest x fashion magazine"

Lead: Claude (design direction, specs, final review). Implementation is delegated per task; verification is by a
fresh agent that did not write the code, at 390px and desktop, in Hebrew and English.

Status: `todo` / `doing` / `review` / `done` / `blocked`. A model that fails a task twice is replaced by the next tier.

| # | Task | Model | Status | Result |
| --- | --- | --- | --- | --- |
| A1 | Feature and route inventory (75 capabilities, gaps, motion, tokens) | Explore | done | Basis of the audit; becomes the regression checklist in 1.9 |
| A2 | Audit + plan | lead | done | Roy, 2026-11-18: five tabs approved; long-press instead of swipe-to-archive; design direction left to the lead with a high bar; scope = design system + existing app first, new features after (`docs/REDESIGN_PLAN.md`) |
| 0 | "Before" screenshots from the live preview: 9 screens x 390/1280 x he/en | lead | done | `design/screens/before/2026-11-18-*.png` (36 files) |
| 1.1 | DESIGN.md v2 | lead | done | Tokens, layout per screen, component table, motion, accessibility |
| 1.2 | Foundations: tokens v2, tileTone, components/ui, /design-system gallery | opus | done | b528fd7. Reviewed by the lead on the gallery (390 he/en, 1280 he, real wardrobe): approved. Web only; native unverified. `insights` icon is the `monitoring` glyph; tab labels use the body font (Plex Mono has no Hebrew) |
| 1.3 | Shell: tab bar (mobile), top nav (desktop), Profile and Insights screens | sonnet | done | 7c1bfea. 117 scripted web checks pass (tabs, deep links, item modal over the bar, resize). Lead reviewed screenshots: approved. Desktop content width of Profile/Insights is polished in 1.8. Native unverified |
| 1.4 | Today (flat-lay hero) | opus | done | 3f3e7ed + a3148a0. Roy approved 2026-11-18. Numbers 01-04 stay on the flat-lay (lead's call: they tie the garments to the legend). Native and real writes unverified |
| 1.5 | Wardrobe: category row, tappable swatches, masonry, filter sheet, long-press actions, reserve flow | opus | done | 3dfd7ec + fixes bc102af. Filter = 2 taps (chip applies and closes), clear-all = 1 tap. Away state and real writes not seen (preview has nothing away and blocks writes) |
| 1.6 | Item: inline chips, overflow actions, redraw composer, shared element from three sources | opus | done | 06b1016 + 451bda8 + 873aee8. Flights verified frame by frame (one copy per frame). Single-field save matches the old editor's payload; reversals restore the baseline. Real writes and the paid redraw not exercised |
| 1.7 | Add: restyle, every failure visible | sonnet | done | 32aa02a. Seven silent failures show a line (1 seen in the real preview, 2-7 in fixtures). The real pipeline (upload, detection, tagging, saving) was not exercised |
| 1.8 | Sign-in, consent, location, loading and error states, Profile/Insights desktop width | sonnet | done | 14baae9 + 8e9cf57. Real Google sign-in and consent approval not exercised |
| 1.9 | Polish, independent verification (390/desktop, he/en), regression checklist, after screenshots | sonnet x4, opus x1 | done | Two verifiers that wrote none of the code: `docs/redesign-checklist-part1.md`, `part2.md` (95 regression rows: 53 pass, 17 UI-only, 6 fixture-only, 14 not reachable, 5 fail; 8 major and 21 minor defects, 0 blockers). All 5 fails and all 8 majors fixed in 692cef0, bc102af, 873aee8, a6a8731; the fixes were checked by the agents that made them, not re-verified independently. 52 after screenshots in `design/screens/after/` |

## Open after stage 1

| What | Why it is open | Who |
| --- | --- | --- |
| Android: gestures, haptics, shadows, hardware back, safe areas, RTL via I18nManager | No emulator in the cloud session; everything was verified in Chromium on the web build | Roy, on an APK |
| Real writes: wear, skip, undo, tag edit, availability, archive, reserve duty | The design preview rejects every write; only the failure and rollback paths were seen | Roy, signed in |
| Real intake pipeline and the paid redraw | Blocked in the preview; never triggered | Roy, signed in (one photo; one redraw only if wanted) |
| Second independent pass over the verification fixes | The fix rounds were checked by their authors | next session |
| Minor defects left from the checklists | Tab labels in Plex Sans (Plex Mono has no Hebrew), 4-piece top at 50% width, masonry sub-pixel gaps, sign-in/consent column on desktop | accepted or stage 2 |
| Engine: "cooler + dressier" can pair a gingham shirt with shorts | Outside the redesign (engine rules) | separate task |
| Stage 2 features | See `docs/REDESIGN_PLAN.md`; each needs its own go | Roy |

## Stage 2 (started 2026-11-19; stage 1 merged as PR #22)

| # | Task | Model | Status | Result |
| --- | --- | --- | --- | --- |
| 2.0 | Specs in DESIGN.md section 3 "שלב 2" | lead | done | |
| 2.1 | Wardrobe: search, "for Shabbat" and formality filters, archive screen with restore, undo after archiving | opus | done | 346a779 + fixes 533b472, 39f39c8, 46c26bf. Shabbat filter: 27 of 82 items after coats and accessories were held to the layer formality bound (wardrobe filter only; engine rules unchanged). Successful archive/restore/undo writes seen only against stubbed calls |
| 2.2 | Item: notes, wear history, manual re-cut | opus | done | ad0ec51 + fixes 39f39c8. Re-cut now asks before replacing an AI redraw (it would have silently replaced 81 of 82 images). Wear history seen only with fixtures: the database has no `worn` wear. Real notes write and real re-cut not exercised |
| 2.3 | Add: queue of photos waiting for Claude | opus | done | b95b37a + fixes d344866. Real listing is empty; populated states seen with a mocked list. No dismiss: storage has no delete policy |
| 2.4 | Insights content (wears, AI spend); Profile: language switch, archive row, sign-out | opus | done | 8d0d799 + fixes d344866. Insights day now follows the location's time zone; spend read is paged. Wears seen with injected fixtures, AI spend with gallery fixtures. Native restart path for language and real sign-out not run |
| 2.5 | Independent verification of stage 2 and of the stage-1 fix rounds | sonnet x2 | done | `docs/redesign-checklist-stage2.md` (96 checks: 62 pass, 12 fail; 6 major, 14 minor) and `docs/redesign-checklist-recheck.md` (31 stage-1 defects: 20 fixed, 4 not fixed, 2 partly, 4 accepted; 5 new majors incl. a live regression: the screen under the item modal vanished). All majors fixed in 39f39c8, 533b472, d344866, 46c26bf. Lead re-ran the item flight on the merged build (frame strips from the wardrobe and Today): the screen stays under the flight. The other fixes were checked by their authors only |

## Open after stage 2

| What | Why it is open | Who |
| --- | --- | --- |
| Everything in "Open after stage 1" above still applies | Android, real writes, real intake and redraw were never exercised | Roy |
| First real wear | No `worn` row exists; wear history, the Insights wears section and their queries have never run on real rows | Roy: press "wearing it" once, then look at the item and at Insights |
| AI cost on a signed-in session | `ai_calls` is not in the preview snapshot; about 500 rows exist this month | Roy |
| Optimistic-edit races | Fixed by a serialised edit queue covered by 12 unit tests; a slow failing write cannot be produced in the preview | first signed-in session |
| `useFeedback` races (overlapping wear/skip writes; overlapping pair-weight learning) | Pre-existing, confirmed by code reading, rare because buttons lock while busy; not changed without a way to run real writes | separate task |
| Public listing of the `cutouts` bucket | Anyone with the anon key can list and download the garment photos (policy "cutouts public read" from the first migration). Closing it needs a migration and signed URLs | Roy's decision |
| Shabbat rules for outerwear and accessories in the engine | The wardrobe filter handles them; the stylist's rules still have no slot for them | Roy's decision |
| Insights outfit sheet: a row "type · Latin name" is drawn left-to-right in Hebrew | Side effect of keeping the start of truncated Latin names; splitting type and name into two texts would fix it | small follow-up |
| Design preview | The server stops answering 2026-11-25; remove the preview code path afterwards (CHANGELOG 2026-11-18) | next session |

## Stage 3 - fixes from Roy's use of the live app (started 2026-11-19)

| # | Task | Model | Status | Result |
| --- | --- | --- | --- | --- |
| 3.1 | Inline writing (name, brand, notes): explicit save and cancel, a visible "saved" line, nothing saved on blur. Roy: "no button or indication, not clear how to save a note; the writing mechanism is not good". Spec: DESIGN.md section 4 "כתיבה במקום" | opus | doing | |
| 3.2 | Today after "wearing it": the status lines leave the bottom bar and sit above the hero, so the flat-lay (shoes) is not covered. Roy sent a phone screenshot of the live app | sonnet | built, awaiting independent check | d65787f. Bar leaves when worn; lines in the skip slot; focus asserted (wear -> undo button, undo -> wear button) at 390/360/1280 he+en with stubbed writes. Not checked: 600-899 card width opened already worn (flat-lay uncapped, only scrolls), native, a real write |
| 3.3 | "Current location" shows the place name (Today weather line, profile row, location screen). Web: Nominatim (OSM, usage policy linked in DESIGN.md); native: the device geocoder. Roy: "in current location it does not say where" | sonnet | doing | |
| 3.4 | Laundry line action reads "אל תעביר לכביסה" / "Keep out of the laundry" (was "השאר בבית"). Roy found the old wording unclear | lead | done | dab317e. Check wrap at 360 with several items in verification |
| 3.5 | Candle lighting for "my current location" follows the local custom (Jerusalem 40, Haifa and Zikhron Ya'akov 30, rest of Israel 20, abroad 18), same rule Hebcal applies to a chosen city. Spec in PRD section 8. Roy: "important that it is correct and accurate" | sonnet | doing | |
