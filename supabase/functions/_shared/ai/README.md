# AI layer

One file per provider, all implementing `AiClient` from `types.ts`:

- `gemini.ts` → `separateGarments` (Gemini 2.5 Flash Image). Not written yet.
- `anthropic.ts` → `tagItem` (Claude Haiku, structured output against `ItemTagsSchema`) and `styleOutfit` (Claude Sonnet, structured output against `StylistOutputSchema`, prompt caching on the wardrobe summary). Not written yet.
- `modal.ts` → `cutout` and `embed` via the worker in `/worker`. Not written yet.
- `log.ts` → `logAiCall(entry)` writes to `ai_calls` with the service role. Not written yet.

Rules that are not negotiable (CLAUDE.md):
- Validate every model response with zod before returning. A parse failure is logged and surfaced as a typed error; callers fall back.
- `styleOutfit` receives at most 8 candidates. The schema enforces it; do not widen it.
- Costs are estimated per call from the provider's published price table and written to `ai_calls.cost_usd`.
