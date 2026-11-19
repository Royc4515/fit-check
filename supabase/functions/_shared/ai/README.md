# AI layer

One file per provider, all implementing `AiClient` from `types.ts`:

- `gemini.ts` → `separateGarments` (Gemini 2.5 Flash Image). Not written yet.
- `anthropic.ts` → `tagItem` (Claude Haiku, structured output against `ItemTagsSchema`) and `styleOutfit` (Claude Sonnet, structured output against `StylistOutputSchema`, prompt caching on the wardrobe summary). Not written yet.
- `modal.ts` → `cutout` and `embed` via the worker in `/worker`. Not written yet.
- `log.ts` → `logAiCall(entry)` writes to `ai_calls` with the service role. Not written yet.
- `tryon.ts` → `renderOutfit(garments, figure)` and `renderFigure()` (Nano Banana 2.1, `gemini-nano-banana-2.1`, one 4:5 image at 1K, no automatic retry). Used only by the `tryon` function (DESIGN.md "שלב 5.3"). Each returns the image bytes and an `AiLogEntry` (task `tryon`) the caller writes. Shown price `TRYON_PRICE_USD` (about $0.055, figure + 4 garments) and `FIGURE_PRICE_USD` (about $0.047, once). Built 2026-11-19; never called against Google yet.
- `budget.ts` → `MONTHLY_GOOGLE_BUDGET_USD`, `monthlyGoogleSpend()` (redraw, detection and try-on models) and `googleBudgetAllows(spent, price)` (spend plus the call must stay within the cap; unknown spend counts as spent).

Rules that are not negotiable (CLAUDE.md):
- Validate every model response with zod before returning. A parse failure is logged and surfaced as a typed error; callers fall back.
- `styleOutfit` receives at most 8 candidates. The schema enforces it; do not widen it.
- Costs are estimated per call from the provider's published price table and written to `ai_calls.cost_usd`.
