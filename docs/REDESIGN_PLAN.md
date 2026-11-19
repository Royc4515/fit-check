# Redesign plan - "Pinterest x fashion magazine"

2026-11-18. Decided with Roy: first the overall design, a complete design system, and a rebuild of everything
that exists today; new features come after, on top of the system. `DESIGN.md` (v2) is the visual spec, this file
is the order of work, `TASKS.md` is the live status.

## Rules of the work

- Nothing that works today disappears or gets harder to reach. The inventory of 75 existing capabilities
  (task A1) is the regression checklist; task 1.9 walks it line by line.
- No change to the data model, the Edge Functions or the MCP tools. Stage 1 is app code only.
- One commit per screen. Each screen is verified by an agent that did not write it: 390px and desktop,
  Hebrew and English, against DESIGN.md sections 1-6. The lead approves or sends back.
- Verification runs in Chromium on the web build with the read-only design preview. Android gestures and
  haptics are not verified here: Roy checks them on an APK.
- The design preview is temporary (server stops answering 2026-11-25). The code is passed to agents at run
  time and never written into the repo.

## Stage 1 - design system and the existing app

| # | Task | Depends on | Done when |
| --- | --- | --- | --- |
| 1.1 | DESIGN.md v2 | - | Written and committed |
| 1.2 | Foundations: tokens v2, `tileTone`, `components/ui/*` (DESIGN.md section 4), a `/design-system` gallery route that shows every component in every state | 1.1 | Gallery renders in he/en at 390 and 1280; lint and typecheck pass; no screen changed yet |
| 1.3 | Shell: bottom tab bar on mobile, top nav on desktop, five destinations, item screen stays a modal above it | 1.2 | Every existing route still reachable; deep links work |
| 1.4 | Today: masthead, borderless composition, tap-a-piece sheet (swap in 2 taps), floating action bar ("wearing it" in 1 tap), adjustments sheet, swipe to skip, worn/skip/laundry status lines | 1.3 | **Roy approves the screen before 1.5 starts** |
| 1.5 | Wardrobe: category row, tappable swatches, masonry, filter sheet, long-press action sheet, reserve-duty flow in the new grid | 1.4 approved | 82 real items scroll smoothly; no layout shift while images load |
| 1.6 | Item: shared element from wardrobe / Today / "goes with", inline chips with optimistic save, overflow actions (replace photo, AI redraw with price, remove), redraw composer restyled | 1.5 | Every field the old editor could change is changeable |
| 1.7 | Add: restyled intake and review; every failure shown with its reason | 1.2 | The seven silent failures from the audit each produce a visible status |
| 1.8 | Profile (location, credits), Insights empty state, sign-in, OAuth consent, loading and error states | 1.3 | No screen left on old one-off styling |
| 1.9 | Accessibility pass, i18n completeness (he/en), regression checklist, after screenshots, CHANGELOG | all | Checklist committed with a result per line |

1.5-1.8 touch different screens and run in parallel in separate worktrees once 1.4 is approved.

## Stage 2 - new features, on the system

Started 2026-11-19 on Roy's go ("merge and continue with your plan"), after stage 1 merged as PR #22. Specs: DESIGN.md section 3 "שלב 2". Four parallel tasks by file ownership: 2.1 wardrobe search, Shabbat and formality filters, archive screen; 2.2 item notes, wear history, manual re-cut; 2.3 intake queue; 2.4 insights content, profile language switch and sign-out. Then an independent verification pass. No migration, no Edge Function change: the intake queue has no dismiss because the storage policies have no delete rule.

| Feature | Notes |
| --- | --- |
| Wardrobe search by name and brand | The header has the slot; client-side over the loaded wardrobe |
| "For Shabbat" and formality filters | Shabbat reuses the engine's context rules so the filter and the stylist agree |
| Archived view with restore | `restoreItem` exists in the data layer and is unused |
| Item notes and wear history | `items.notes` and `wears` already exist; read and write only |
| Intake queue for photos sent to Claude | Lists `cutouts/{uid}/pending/`, with dismiss |
| Manual re-cut | Needs the Modal workspace, disabled since 2026-11-18 |
| Insights: outfit history, AI spend | AI spend from `ai_calls`; clothing spend only once prices are entered (none today) |
| Profile: language switch, sign-out | |

## Stage 3 - fixes from use of the live app (done)

2026-11-19, PR #24. Roy used the merged redesign on his phone and sent findings; each became a row in
`TASKS.md` "Stage 3": explicit save for name, brand and notes; the worn lines above the flat-lay and a flat-lay
that always fits; the place name for the current location; candle lighting by the local custom at the current
location; the end of Shabbat on Today. Verified twice by an agent that did not write the code
(`docs/redesign-checklist-stage3.md`). What nobody could check is in `TASKS.md` "Open after stage 3".

## Stage 4 - from a finished redesign to a daily habit (proposed 2026-11-19, waiting for Roy's go)

The PRD has one success measure: 14 days in a row of daily use. The redesign made the app pleasant; it did not
make it part of the morning. An inventory of the PRD against the code (2026-11-19) shows what stands between
the two:

- Nothing calls Roy in the morning. `expo-notifications` is installed and never imported.
- On Friday, Today offers a weekday outfit. The Shabbat context starts only on Saturday, so the suggestion for
  Shabbat clothes is missing exactly when it is needed.
- The Android app has a build profile and has never been built or run. Everything was checked in Chromium.
- Every write was verified with stubs. One real wear exists (Roy, 2026-11-19).
- The design preview, the only way agents see real data, stops answering on 2026-11-25.

### Order of work

| # | Task | Why now | Needs from Roy |
| --- | --- | --- | --- |
| 4.1 | Friday is for Shabbat. On a Friday and on the eve of a holiday Today shows two outfits, "היום" and "לשבת" / "לחג", switched by `TextTabs` above the flat-lay; each can be worn, swapped and adjusted. Engine: the evening's day type comes from "candles today" (already computed in `shabbatTimes`). | Largest gap for a weekly, real need; app code and pure engine only | Go. Open PRD question: is light blue or a thin stripe "respectable" for Shabbat, or white and navy only |
| 4.2 | A way to verify after 2026-11-25. Either extend the design preview's end date (one constant in an Edge Function), or build a fixture session from the anonymised wardrobe. | Without it stage 4 cannot be verified against real data | Decision: extend the preview until the app is finished (recommended), or fixtures |
| 4.3 | Android: first APK (`pnpm build:android`, EAS), then a native pass over the list in `TASKS.md` (gestures, haptics, shadows, hardware back, safe areas, RTL, keyboard against the save row, device geocoder), then one fix round. | Push and haptics exist only on native; the PRD's device is Android | Roy runs the build (EAS account) and installs the APK, or adds an `EXPO_TOKEN` secret to the environment |
| 4.4 | Morning notification, scheduled on the device: every day at an hour Roy chooses; on Fridays and holiday eves three hours before candle lighting (PRD 4.3). Local scheduling with `expo-notifications`: no server, no cron, no push token, nothing new to pay for. Setting on the profile screen. | The outfit is already computed on the device, so a local notification is enough for the habit | Go, after 4.3 (native only; the web app cannot notify) |
| 4.5 | A manual context for today: date, interview, event. The engine's rules exist and nothing can select them. One row in the adjustments sheet, "מה יש היום". | Small, and it uses rules that are already written and tested | Go |
| 4.6 | Reserve duty as a real flow: the packing list counts white T-shirts and warns when there are too few clean ones. | Roy leaves most weekends | The number of T-shirts for a weekend (open PRD question) |
| 4.7 | Hardening: the two `useFeedback` races; unit tests for `planToday`, wardrobe filters, the day-context loader and the feedback layer; wear history cached for offline; the 90-day learning window the config promises and nothing applies; the open minors from stage 3. | Real writes start to matter once the app is used daily | - |
| 4.8 | Clean-up: remove the design preview (when the app is finished, Roy 2026-11-19); delete the `redraw-five` function, whose one-time code is in the repo and expired; bring `supabase/config.toml` and the docs in line with what is deployed; decide on the public listing of the `cutouts` bucket. | Debt with a security edge | Go for each Edge Function or storage change |

4.1, 4.5 and 4.7 touch different files and can run in parallel. 4.4 waits for 4.3. Each task: spec in
`DESIGN.md` or `PRD.md` first, built by a subagent, verified by one that did not write it, one commit per screen.

### Not in stage 4 (each needs a decision, money or a schema change)

| What | What it needs |
| --- | --- |
| Background removal and embeddings (the Modal worker, disabled since 2026-11-18) | Roy re-enables the Modal workspace; it has a cost |
| Pre-purchase check (PRD 4.5) | Embeddings or a paid model call per check; a new screen |
| A server-side daily outfit with remote push (`generate-daily`, pg_cron) | Only if the local notification of 4.4 turns out not to be enough |
| Onboarding: sizes, editing the context rules, re-importing the sheet | Low value for one user who is already set up |
| Trip packing lists, Google Calendar | PRD version 2 |

## Delegation

| Kind of work | Model |
| --- | --- |
| Design direction, specs, review, anything failed twice | lead |
| Tokens and component foundations, masonry virtualization, sheet and swipe physics, shared element | opus |
| Building a screen from its spec, wiring, refactors, verification | sonnet |
| String extraction, renames, lint fixes, screenshots, checklists | haiku |
