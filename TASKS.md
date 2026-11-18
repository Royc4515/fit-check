# TASKS - redesign "Pinterest x fashion magazine"

Lead: Claude (design direction, specs, final review). Implementation is delegated per task; verification is by a
fresh agent that did not write the code, at 390px and desktop, in Hebrew and English.

Status: `todo` / `doing` / `review` / `done` / `blocked`. A model that fails a task twice is replaced by the next tier.

| # | Task | Model | Status | Result |
| --- | --- | --- | --- | --- |
| A1 | Feature and route inventory (75 capabilities, gaps, motion, tokens) | Explore | done | Basis of the audit; becomes the regression checklist in task 10 |
| A2 | Audit + plan presented to Roy | lead | done | Waiting for Roy's decisions (navigation, DESIGN.md edits, scope, swipe-to-archive) |
| 0 | "Before" screenshots from the live preview: 9 screens x 390/1280 x he/en | lead | done | `design/screens/before/2026-11-18-*.png` (36 files) |
| 1 | DESIGN.md v2: tokens, components, motion spec | lead | blocked | Needs Roy's decisions |
| 2 | Tokens + component library (Button, Chip, Card, Sheet, Swatch, EmptyState, Skeleton, Icon) | opus | todo | |
| 3 | Bottom tab bar shell | sonnet | todo | |
| 4 | Today: hero, one-tap "wore this", tap-a-piece swap, adjustments sheet. Stop for Roy's approval | sonnet + opus (gestures) | todo | |
| 5 | Wardrobe: MasonryGrid (opus); filters sheet, search, tappable swatches, archive view (sonnet) | opus + sonnet | todo | |
| 6 | Item: inline tag chips, notes, wear history, actions; shared-element from Today too | sonnet + opus | todo | |
| 7 | Intake: pending queue, visible status for every failure | sonnet | todo | |
| 8 | Insights: outfit history, AI spend | sonnet | todo | |
| 9 | Profile: language, location, sign-out | sonnet | todo | |
| 10 | Accessibility pass, i18n strings, checklist of all pre-existing features | haiku + sonnet | todo | |
