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
| 1.4 | Today (flat-lay hero). Stop for Roy's approval | opus | review | 3f3e7ed merged. Lead reviewed at 390 he/en and 1280: composition approved. Fix round open: touch scroll blocked over the hero on mobile web, sheet ground, skip line placement, safe area inside tabs, desktop hero height. Waiting for Roy's approval of the screen |
| 1.5 | Wardrobe: masonry (opus), filters and reserve flow (sonnet) | opus + sonnet | todo | |
| 1.6 | Item: inline chips, overflow actions, shared element from three sources | sonnet + opus | todo | |
| 1.7 | Add: restyle, every failure visible | sonnet | todo | |
| 1.8 | Profile, Insights empty state, sign-in, consent, loading and error states | sonnet | todo | |
| 1.9 | Accessibility, i18n, regression checklist, after screenshots | haiku + sonnet | todo | |
