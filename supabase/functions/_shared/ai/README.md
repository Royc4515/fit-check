# AI layer

Every call to a model provider goes through this folder. Edge Functions never call a provider directly.

| File | Exports | Model | Called by |
| --- | --- | --- | --- |
| `gemini.ts` | `detectGarments`: a box, a rough category, a description and the shot's problems for each garment in a photo | `gemini-3.8-flash` (paid key, then free key), then `gemini-3.5-flash-lite` (free) on 429/500/503 or a timeout | `intake-separate` |
| `gemini.ts` | `enhanceGarment`: redraws one cropped garment as a clean product photo | `gemini-3.1-flash-lite-image` (paid only, on request) | `intake-separate`, `mcp` (`item_redraw`) |
| `tagger.ts` | `tagItem`: tags one cutout against `ItemTagsSchema`; the wardrobe summary is sent with prompt caching | `claude-haiku-5-5` (Sonnet is the candidate under trial) | `intake-tag` |
| `duplicates.ts` | `findDuplicate`: is this the same physical garment as one of up to 4 look-alikes? A separate call, so a failure never costs the tags | `claude-haiku-5-5` | `intake-tag` |
| `anthropic.ts` | `styleOutfit`: picks one of at most 8 engine candidates and explains it in Hebrew and English | `claude-sonnet-5-5` | `style-outfit` |
| `stylist-persona.ts` | `STYLIST_SYSTEM`: the stylist's Hebrew system prompt, kept apart so tone can change without touching the call | - | `anthropic.ts` |
| `modal.ts` | `cutout`: background removal on the Modal worker (BiRefNet, SAM 2 to keep the front garment) | worker in `/worker` | `intake-cutout`, `mcp` (`item_recut`) |
| `tryon.ts` | `renderOutfit`, `renderFigure`: one generated image of the whole outfit (stage 5.3; never called against Google yet) | `gemini-nano-banana-2.1` | `tryon` |
| `log.ts` | `logAiCall`, `countAiCalls`, `sumAiCost`: the `ai_calls` table (service role) | - | every caller |
| `budget.ts` | `MONTHLY_GOOGLE_BUDGET_USD` (8), `monthlyGoogleSpend`, `googleBudgetAllows` | - | paid Google calls |
| `types.ts` | `AiLogEntry` and shared result types | - | - |

Not built: `extractReceipt` (v2) and the worker's `/embed` (FashionCLIP; the endpoint exists, nothing calls it).

Rules that are not negotiable (CLAUDE.md):
- Validate every model response with zod before returning. A parse failure is logged and surfaced as a typed error; callers fall back.
- `styleOutfit` receives at most 8 candidates. The schema enforces it; do not widen it.
- Every call returns an `AiLogEntry` with an estimated cost from the provider's published prices, and the caller writes it to `ai_calls`.
- Paid Google calls check `googleBudgetAllows` first. When the cap is reached the feature says so and stops; it never falls back to another paid path.
