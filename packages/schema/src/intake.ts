import { z } from "zod";
import { CATEGORIES } from "./item-tags.ts";

/** At most this many garments are extracted from one photo: a bed covered in clothes is several photos, not one. */
export const MAX_GARMENTS_PER_PHOTO = 6;

/**
 * Input of the intake-separate Edge Function, two actions:
 * - separate (default): a photo the user already uploaded to `originals/{uid}/...`; free segmentation.
 * - enhance: one cutout from a previous separate, redrawn as a product photo by the paid image model.
 */
export const IntakeSeparateInputSchema = z.union([
  z.object({ action: z.literal("separate").default("separate"), original_path: z.string().min(3).max(300) }),
  z.object({ action: z.literal("enhance"), cutout_path: z.string().min(3).max(300), description: z.string().min(2).max(400) }),
]);
export type IntakeSeparateInput = z.infer<typeof IntakeSeparateInputSchema>;

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

export const IntakeEnhanceResultSchema = z.union([
  z.object({ ok: z.literal(true), path: z.string(), url: z.string().url() }),
  z.object({ ok: z.literal(false), reason: z.string() }),
]);
export type IntakeEnhanceResult = z.infer<typeof IntakeEnhanceResultSchema>;
