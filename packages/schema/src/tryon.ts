import { z } from "zod";
import { SLOTS } from "./stylist.ts";

/**
 * The `tryon` Edge Function's contract (DESIGN.md "שלב 5.3" item 4): one generated image of a whole outfit on the
 * fixed figure. Shared with the app so the sheet (a later pull request) reads the same types the function writes.
 *
 * Modes:
 * - quote: the price, the month's Google spend and cap, and whether an image for exactly these garments is stored.
 *   Never generates and never costs.
 * - render: returns the stored image for these garments when there is one, else generates it.
 * - rerender: always generates and replaces the stored image (costs again; only on an explicit press).
 */
export const TRYON_MODES = ["quote", "render", "rerender"] as const;
export type TryonMode = (typeof TRYON_MODES)[number];

export const TryonItemSchema = z.object({
  item_id: z.string().uuid(),
  slot: z.enum(SLOTS),
});
export type TryonItem = z.infer<typeof TryonItemSchema>;

/**
 * The outfit rule: exactly one top, one bottom and one pair of shoes, at most one layer, no garment twice.
 * don't touch / the 3..4 bound is also the model's reference budget: figure + 4 garments = 5 images, well inside the
 * documented 10 object references, and the price constant in `_shared/ai/tryon.ts` assumes at most 4 garments.
 */
export const TryonRequestSchema = z
  .object({
    mode: z.enum(TRYON_MODES),
    items: z.array(TryonItemSchema).min(3).max(4),
  })
  .superRefine((req, ctx) => {
    const count = (slot: (typeof SLOTS)[number]) => req.items.filter((i) => i.slot === slot).length;
    for (const slot of ["top", "bottom", "shoes"] as const) {
      if (count(slot) !== 1) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["items"], message: `exactly one ${slot} required` });
    }
    if (count("layer") > 1) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["items"], message: "at most one layer" });
    if (new Set(req.items.map((i) => i.item_id)).size !== req.items.length) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["items"], message: "an item appears twice" });
    }
  });
export type TryonRequest = z.infer<typeof TryonRequestSchema>;

const usd = z.number().min(0);

/** `month_spend_usd` is null when the spend could not be read; the function then refuses to generate (unknown = spent). */
export const TryonQuoteResponseSchema = z.object({
  ok: z.literal(true),
  mode: z.literal("quote"),
  /** What pressing "render" would cost now: the outfit image, plus the one-time figure while it does not exist yet. */
  price_usd: usd,
  includes_figure: z.boolean(),
  month_spend_usd: usd.nullable(),
  budget_usd: usd,
  /** An image for exactly these garments (and this figure and model) is stored; render would return it for free. */
  cached: z.boolean(),
});
export type TryonQuoteResponse = z.infer<typeof TryonQuoteResponseSchema>;

export const TryonRenderResponseSchema = z.object({
  ok: z.literal(true),
  mode: z.enum(["render", "rerender"]),
  /** A short-lived signed URL; the image itself stays in a private bucket. */
  image_url: z.string().url(),
  expires_in_s: z.number().int().positive(),
  cached: z.boolean(),
  /** Estimated USD this press cost (0 when cached; the figure's cost included when it was created on this press). */
  cost_usd: usd,
  month_spend_usd: usd.nullable(),
  budget_usd: usd,
});
export type TryonRenderResponse = z.infer<typeof TryonRenderResponseSchema>;

/**
 * Stable error codes; the app words each one. `storage_error` is the one code beyond the spec's list: a private
 * bucket read or write failed, which is neither the user's input nor the provider.
 */
export const TRYON_ERROR_CODES = [
  "invalid_input",
  "unauthenticated",
  "item_not_found",
  "item_has_no_image",
  "budget_reached",
  "provider_refused",
  "provider_timeout",
  "provider_error",
  "storage_error",
] as const;
export type TryonErrorCode = (typeof TRYON_ERROR_CODES)[number];

export const TryonErrorResponseSchema = z.object({
  ok: z.literal(false),
  error: z.enum(TRYON_ERROR_CODES),
  /** The garment the error is about (item_not_found, item_has_no_image). */
  item_id: z.string().optional(),
  /** budget_reached only: what the sheet shows ("מתחדש ב-1 בחודש"). */
  month_spend_usd: usd.nullable().optional(),
  budget_usd: usd.optional(),
});
export type TryonErrorResponse = z.infer<typeof TryonErrorResponseSchema>;

export const TryonResponseSchema = z.union([TryonQuoteResponseSchema, TryonRenderResponseSchema, TryonErrorResponseSchema]);
export type TryonResponse = z.infer<typeof TryonResponseSchema>;

/**
 * The string the stored image's name is hashed from. Order-independent on purpose: the same garments in another
 * order are the same outfit and must hit the same stored image (no second payment).
 * don't touch / every input that changes the picture is in here: a new figure version or a new model id must miss
 * the cache, or the sheet would show an image drawn on the old figure as if it were current.
 */
export function tryonCacheKeyInput(userId: string, itemIds: readonly string[], figureVersion: string, model: string): string {
  return ["tryon", userId, [...itemIds].sort().join(","), figureVersion, model].join("|");
}
