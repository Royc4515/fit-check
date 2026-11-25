import { z } from "zod";
import { ItemTagsSchema } from "./item-tags.ts";
import { SLOTS } from "./stylist.ts";

/**
 * One garment of the sign-in cover's look: enough to lay it out and draw it, nothing else (no name, brand or
 * price: the answer is public).
 */
export const ShowcasePieceSchema = z.object({
  slot: z.enum(SLOTS),
  item: z.object({
    id: z.string().uuid(),
    tags: ItemTagsSchema,
    cutout_path: z.string().min(1),
    thumb_path: z.string().min(1).nullable(),
  }),
});
export type ShowcasePiece = z.infer<typeof ShowcasePieceSchema>;

/**
 * The `showcase` Edge Function's answer: the owner's look on the sign-in screen (Roy, 2026-11-25: a real look of his
 * instead of the drawn one). `none` when there is no look to show; the screen then keeps the drawing.
 */
export const ShowcaseResponseSchema = z.union([
  z.object({
    ok: z.literal(true),
    pieces: z
      .array(ShowcasePieceSchema)
      .min(3)
      .max(4)
      .refine((pieces) => new Set(pieces.map((p) => p.slot)).size === pieces.length, "one piece per slot"),
  }),
  z.object({ ok: z.literal(false), reason: z.string() }),
]);
export type ShowcaseResponse = z.infer<typeof ShowcaseResponseSchema>;
