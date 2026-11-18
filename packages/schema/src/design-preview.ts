import { z } from "zod";

/**
 * TEMPORARY (Roy, 2026-11-18; dead after 2026-11-25T16:00:00Z): the wire format of the read-only design preview,
 * shared by the `design-preview` Edge Function and the web app's preview mode (apps/mobile/src/data/preview.ts).
 * Remove this module together with them.
 */

/** The only input the function takes. Bounded so a huge body cannot make the code comparison expensive. */
export const DesignPreviewInputSchema = z.object({ code: z.string().min(1).max(256) });
export type DesignPreviewInput = z.infer<typeof DesignPreviewInputSchema>;

export const PairWeightRowSchema = z.object({
  item_a: z.string(),
  item_b: z.string(),
  // numeric: a number, or a string when PostgREST cannot represent it exactly (same reasoning as items.price).
  weight: z.union([z.number(), z.string()]),
});

export const RedrawSpecRowSchema = z.object({ id: z.string(), redraw_spec: z.unknown() });

/**
 * The snapshot: one owner's rows, in exactly the shapes the app's Supabase reads return.
 * `items` and `wears` stay `unknown` on purpose: each read path parses them with its own row schema
 * (itemFromRow, WearRowSchema) and skips a bad row, the same as it does with a live response. Validating them here
 * too would make one bad row fail the whole preview, which the live app never does.
 */
export const DesignPreviewSnapshotSchema = z.object({
  ok: z.literal(true),
  owner: z.string(),
  expires_at: z.string(),
  items: z.array(z.unknown()),
  pair_weights: z.array(PairWeightRowSchema),
  wears: z.array(z.unknown()),
  redraw_specs: z.array(RedrawSpecRowSchema),
});
export type DesignPreviewSnapshot = z.infer<typeof DesignPreviewSnapshotSchema>;

/**
 * Parses a design-preview response body. Null for anything that is not a snapshot (an error body, a proxy page,
 * a changed shape), so the caller has one failure path instead of guessing which field broke.
 */
export function parseDesignPreviewSnapshot(raw: unknown): DesignPreviewSnapshot | null {
  const parsed = DesignPreviewSnapshotSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}
