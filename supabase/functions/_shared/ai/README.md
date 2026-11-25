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
| `background.ts` | `removeBackground`: Cloudflare first, Modal as fallback; logs each provider it called; reasons `not_configured`, `cutout_monthly_limit`, `ai_failed` | - | `intake-cutout`, `mcp` (intake, `item_recut`, redraw) |
| `cloudflare.ts` | `cutoutCloudflare`: background removal on the `fit-check-cutout` Worker (Cloudflare Images segment, trim, 400 px thumbnail); `MONTHLY_CLOUDFLARE_CUTOUTS` (2,400), `cloudflareAllows` | `cf-images-segment-foreground`, Worker in `/worker/cloudflare` | `background.ts` |
| `modal.ts` | `cutout`: background removal on the Modal worker (BiRefNet, SAM 2 to keep the front garment) | worker in `/worker` | `background.ts` |
| `tryon.ts` | `renderOutfit`, `renderFigure`: one generated image of the whole outfit (stage 5.3; never called against Google yet) | `gemini-nano-banana-2.1` | `tryon` |
| `log.ts` | `logAiCall`, `countAiCalls`, `sumAiCost`, `sumProviderCost`, `countModelCalls`: the `ai_calls` table (service role) | - | every caller |
| `budget.ts` | `MONTHLY_GOOGLE_BUDGET_USD` (8), `monthlyGoogleSpend`, `googleBudgetAllows`; `MONTHLY_ANTHROPIC_BUDGET_USD` (80), `monthlyAnthropicSpend`, `anthropicBudgetAllows` | - | paid Google calls; `intake-tag`, `style-outfit` |
| `types.ts` | `AiLogEntry` and shared result types | - | - |

Not built: `extractReceipt` (v2) and image embeddings (planned on `gemini-embedding-2`, `docs/TASKS.md` 5.5; the worker's unused `/embed` endpoint was removed 2026-11-25).

Rules that are not negotiable (CLAUDE.md):
- Validate every model response with zod before returning. A parse failure is logged and surfaced as a typed error; callers fall back.
- `styleOutfit` receives at most 8 candidates. The schema enforces it; do not widen it.
- Every call returns an `AiLogEntry` with an estimated cost from the provider's published prices, and the caller writes it to `ai_calls`.
- Paid Google calls check `googleBudgetAllows` first, Anthropic calls `anthropicBudgetAllows`. When the cap is reached the feature says so and stops; it never falls back to another paid path.
