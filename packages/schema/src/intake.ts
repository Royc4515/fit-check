import { z } from "zod";
import { CATEGORIES, ItemTagsSchema } from "./item-tags.ts";

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
 * - detect (default): a photo the user already uploaded to `originals/{uid}/...`; garment detection. With `single`,
 *   only the main garment (front, centre) comes back.
 * - enhance: one cropped garment the app uploaded to `cutouts/{uid}/...`, redrawn by the paid image model.
 */
export const IntakeSeparateInputSchema = z.union([
  z.object({
    action: z.literal("detect").default("detect"),
    original_path: z.string().min(3).max(300),
    // One-garment mode: return only the main garment and ignore what hangs behind or around it.
    single: z.boolean().optional(),
  }),
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

/**
 * Tagging models offered to intake-tag. Haiku is the CLAUDE.md default; Sonnet is on trial (Roy, 2026-11-09:
 * fabric and shade were wrong, so both are compared on real photos before one is fixed here).
 */
export const TAG_MODELS = ["claude-haiku-5-5", "claude-sonnet-5-5"] as const;
export type TagModel = (typeof TAG_MODELS)[number];

/**
 * Input of intake-tag: one cropped garment in `cutouts/{uid}/...`, optionally a photo of its care label in the
 * same folder (the only reliable source for fabric composition), and detection's short description as a hint.
 */
export const IntakeTagInputSchema = z.object({
  cutout_path: z.string().min(3).max(300),
  label_path: z.string().min(3).max(300).optional(),
  hint: z.string().max(400).optional(),
  model: z.enum(TAG_MODELS).optional(),
});
export type IntakeTagInput = z.infer<typeof IntakeTagInputSchema>;

/**
 * What the tagger proposes for one garment. `tags` is the frozen ItemTags shape; the rest only helps the user
 * confirm: a display name in the wardrobe's existing style, the brand if a logo or label shows it, the composition
 * read off a care label, and which fields the model was unsure about.
 */
export const TagProposalSchema = z.object({
  name: z.string().min(2).max(80),
  brand: z.string().max(60).nullable(),
  tags: ItemTagsSchema,
  label_composition: z.string().max(120).nullable(),
  uncertain: z.array(z.enum(["subcategory", "color", "pattern", "material", "fit", "sleeve"])),
});
export type TagProposal = z.infer<typeof TagProposalSchema>;

export const IntakeTagResultSchema = z.union([
  z.object({
    ok: z.literal(true),
    proposal: TagProposalSchema,
    model: z.string(),
    /** A wardrobe item that is the same physical garment (high confidence only), or null. */
    duplicate: z.object({ item_id: z.string(), name: z.string(), image_path: z.string() }).nullable().optional(),
  }),
  z.object({ ok: z.literal(false), reason: z.string() }),
]);
export type IntakeTagResult = z.infer<typeof IntakeTagResultSchema>;

/** Input of intake-cutout: one crop the app uploaded to `cutouts/{uid}/...`, to get its background removed. */
export const IntakeCutoutInputSchema = z.object({ cutout_path: z.string().min(3).max(300) });

export const IntakeCutoutResultSchema = z.union([
  z.object({ ok: z.literal(true), path: z.string(), thumb_path: z.string(), url: z.string().url() }),
  z.object({ ok: z.literal(false), reason: z.string() }),
]);
export type IntakeCutoutResult = z.infer<typeof IntakeCutoutResultSchema>;
