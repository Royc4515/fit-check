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
| 1.2 | Foundations: tokens v2, tileTone, components/ui, /design-system gallery | opus | doing | |
| 1.3 | Shell: tab bar (mobile), top nav (desktop) | sonnet | todo | |
| 1.4 | Today. Stop for Roy's approval | sonnet + opus (gestures) | todo | |
| 1.5 | Wardrobe: masonry (opus), filters and reserve flow (sonnet) | opus + sonnet | todo | |
| 1.6 | Item: inline chips, overflow actions, shared element from three sources | sonnet + opus | todo | |
| 1.7 | Add: restyle, every failure visible | sonnet | todo | |
| 1.8 | Profile, Insights empty state, sign-in, consent, loading and error states | sonnet | todo | |
| 1.9 | Accessibility, i18n, regression checklist, after screenshots | haiku + sonnet | todo | |
