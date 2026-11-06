import { z } from "zod";
import { COLOR_NAMES, SUBCATEGORIES } from "./item-tags";
import { CONTEXT_TYPES } from "./context";

export const SLOTS = ["top", "bottom", "shoes", "layer"] as const;
export type Slot = (typeof SLOTS)[number];

/** A scored outfit the engine produced. This is what the LLM is allowed to see. */
export const CandidateItemSchema = z.object({
  id: z.string(),
  slot: z.enum(SLOTS),
  name: z.string(),
  subcategory: z.enum(SUBCATEGORIES),
  color_name: z.enum(COLOR_NAMES),
  formality: z.number().int().min(1).max(10),
});

export const CandidateOutfitSchema = z.object({
  outfit_id: z.string(),
  items: z.array(CandidateItemSchema).min(3).max(4),
  score: z.number().min(0).max(1),
  // Breakdown is passed so the stylist can explain, not recompute.
  breakdown: z.object({
    color_harmony: z.number(),
    formality_consistency: z.number(),
    context_fit: z.number(),
    recency_penalty: z.number(),
    pair_weight: z.number(),
  }),
});

export type CandidateOutfit = z.infer<typeof CandidateOutfitSchema>;

/** Input to `styleOutfit`. Hard cap of 8 candidates is enforced here, not only in prose. */
export const StylistInputSchema = z.object({
  context_type: z.enum(CONTEXT_TYPES),
  date_label_he: z.string(),
  weather_summary: z.string(),
  candidates: z.array(CandidateOutfitSchema).min(1).max(8),
  recent_outfits_summary: z.array(z.string()).max(7),
});

export type StylistInput = z.infer<typeof StylistInputSchema>;

/** Output of `styleOutfit`. Anything else from the model is a parse failure. */
export const StylistOutputSchema = z.object({
  chosen_outfit_id: z.string(),
  explanation_he: z.string().min(10).max(400),
  explanation_en: z.string().min(10).max(400),
  swap_suggestion: z
    .object({
      slot: z.enum(SLOTS),
      item_id: z.string(),
      reason_he: z.string().max(200),
    })
    .nullable(),
});

export type StylistOutput = z.infer<typeof StylistOutputSchema>;
