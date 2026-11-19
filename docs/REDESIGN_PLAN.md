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

## Delegation

| Kind of work | Model |
| --- | --- |
| Design direction, specs, review, anything failed twice | lead |
| Tokens and component foundations, masonry virtualization, sheet and swipe physics, shared element | opus |
| Building a screen from its spec, wiring, refactors, verification | sonnet |
| String extraction, renames, lint fixes, screenshots, checklists | haiku |
