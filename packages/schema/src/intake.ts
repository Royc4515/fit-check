import { z } from "zod";
import { CATEGORIES } from "./item-tags.ts";

/** At most this many garments are extracted from one photo: a bed covered in clothes is several photos, not one. */
export const MAX_GARMENTS_PER_PHOTO = 6;

/**
 * What the vision model reports before extraction: one entry per garment it can see well enough to isolate.
 * `description` is written for the image model ("navy crew-neck knit sweater with ribbed cuffs"), so it must be
 * specific enough to pick that garment out of the photo and nothing else.
 */
export const GarmentListSchema = z.object({
  garments: z
    .array(
      z.object({
        category: z.enum(CATEGORIES),
        description: z.string().min(5).max(400),
      })
    )
    .max(MAX_GARMENTS_PER_PHOTO),
});
export type GarmentList = z.infer<typeof GarmentListSchema>;

/** Input of the intake-separate Edge Function: a photo the user already uploaded to `originals/{uid}/...`. */
export const IntakeSeparateInputSchema = z.object({
  original_path: z.string().min(3).max(300),
});

/** One extracted garment, stored in the public `cutouts` bucket. */
export const ExtractedGarmentSchema = z.object({
  category: z.enum(CATEGORIES),
  description: z.string(),
  path: z.string(),
  url: z.string().url(),
});
export type ExtractedGarment = z.infer<typeof ExtractedGarmentSchema>;

export const IntakeSeparateResultSchema = z.union([
  z.object({ ok: z.literal(true), garments: z.array(ExtractedGarmentSchema), skipped: z.number().int() }),
  z.object({ ok: z.literal(false), reason: z.string() }),
]);
export type IntakeSeparateResult = z.infer<typeof IntakeSeparateResultSchema>;
