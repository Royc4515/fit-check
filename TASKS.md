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
| 2.1 | Wardrobe: search, "for Shabbat" and formality filters, archive screen with restore, undo after archiving | sonnet | doing | |
| 2.2 | Item: notes, wear history, manual re-cut | sonnet | doing | |
| 2.3 | Add: queue of photos waiting for Claude | sonnet | doing | |
| 2.4 | Insights content (wears, AI spend); Profile: language switch, archive row, sign-out | sonnet | doing | |
| 2.5 | Independent verification of stage 2 and of the stage-1 fix rounds | sonnet | todo | |
