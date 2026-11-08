import { z } from "zod";
import { CATEGORIES } from "./item-tags.ts";

/** At most this many garments are taken from one photo: a bed covered in clothes is several photos, not one. */
export const MAX_GARMENTS_PER_PHOTO = 6;

/**
 * What can be wrong with one garment in a photo. Any issue makes the app suggest a retake of that garment first,
 * then the paid "improve with AI" redraw (Roy, 2026-11-08: retake, then generation; the drawing is the last resort).
 */
export const GARMENT_ISSUES = ["occluded", "overlapping", "cut_off", "wrinkled", "blurry", "dark"] as const;
export type GarmentIssue = (typeof GARMENT_ISSUES)[number];

/** Gemini's box convention: [ymin, xmin, ymax, xmax], each normalised to 0..1000. */
export const BoxSchema = z.tuple([z.number(), z.number(), z.number(), z.number()]);

/** One garment found in a photo: where it is, what it is, and what is wrong with the shot of it. */
export const DetectedGarmentSchema = z.object({
  box: BoxSchema,
  category: z.enum(CATEGORIES),
  description: z.string().min(2).max(400),
  issues: z.array(z.enum(GARMENT_ISSUES)),
});
export type DetectedGarment = z.infer<typeof DetectedGarmentSchema>;

/**
 * Input of the intake-separate Edge Function, two actions:
 * - detect (default): a photo the user already uploaded to `originals/{uid}/...`; free garment detection.
 * - enhance: one cropped garment the app uploaded to `cutouts/{uid}/...`, redrawn by the paid image model.
 */
export const IntakeSeparateInputSchema = z.union([
  z.object({ action: z.literal("detect").default("detect"), original_path: z.string().min(3).max(300) }),
  z.object({ action: z.literal("enhance"), cutout_path: z.string().min(3).max(300), description: z.string().min(2).max(400) }),
]);
export type IntakeSeparateInput = z.infer<typeof IntakeSeparateInputSchema>;

export const IntakeDetectResultSchema = z.union([
  z.object({ ok: z.literal(true), garments: z.array(DetectedGarmentSchema) }),
  z.object({ ok: z.literal(false), reason: z.string() }),
]);
export type IntakeDetectResult = z.infer<typeof IntakeDetectResultSchema>;

export const IntakeEnhanceResultSchema = z.union([
  z.object({ ok: z.literal(true), path: z.string(), url: z.string().url() }),
  z.object({ ok: z.literal(false), reason: z.string() }),
]);
export type IntakeEnhanceResult = z.infer<typeof IntakeEnhanceResultSchema>;
