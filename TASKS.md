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
| 1.5 | Wardrobe: category row, tappable swatches, masonry, filter sheet, long-press actions, reserve flow | opus | review | 3dfd7ec merged. Lead reviewed all / filters / long-press at 390 he and the filter dialog at 1280: approved. For the final round: tighten the gap between the swatch row and the first section heading; warm the tile-cool tone slightly. Away state and real writes not seen (preview has nothing away and blocks writes) |
| 1.6 | Item: inline chips, overflow actions, redraw composer, shared element from three sources | opus | doing | |
| 1.7 | Add: restyle, every failure visible | sonnet | review | 32aa02a merged. Seven silent failures now show a line (path 1 seen in the real preview, 2-7 in gallery fixtures only). Lead reviewed idle, review card and failure lines at 390 he: approved. The real pipeline (upload, detection, tagging, saving) was not exercised: the preview blocks it |
| 1.8 | Sign-in, consent, location, loading and error states, Profile/Insights desktop width | sonnet | review | 14baae9 merged. Lead reviewed sign-in, location, consent at 390 he: approved with one fix for the final round (the Latin app name sits on the wrong edge in Hebrew on sign-in). Real Google sign-in and consent approval not exercised |
| 1.9 | Accessibility, i18n, regression checklist, after screenshots | haiku + sonnet | todo | |
