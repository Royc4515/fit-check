import type { ContextRules, ContextType, Subcategory } from "@fit-check/schema";

/**
 * All tunable numbers of the engine. Changing a weight is a config change, not a
 * code change, so this file is the only place to touch when outfits feel off.
 */
export const SCORING_WEIGHTS = {
  color_harmony: 0.3,
  formality_consistency: 0.25,
  context_fit: 0.25,
  pair_weight: 0.2,
} as const;

export const RECENCY = {
  /** Days during which a worn item is penalized. */
  item_window_days: 3,
  item_penalty: 0.5,
  /** Days during which an identical full outfit is penalized. */
  outfit_window_days: 14,
  outfit_penalty: 1.0,
} as const;

export const FEEDBACK = {
  worn_pair_delta: 0.05,
  disliked_pair_delta: -0.1,
  learning_window_days: 90,
} as const;

/** Below this temperature a `layer` slot becomes mandatory; above it, forbidden. */
export const LAYER_THRESHOLD_C = 19;

/**
 * How many items per slot survive pre-ranking before combinatorial scoring (10*8*6*6 = 2,880 outfits at most).
 * Tops get the most room because they carry the most variety (45 of 108 items).
 */
export const PER_SLOT_LIMIT = { top: 10, bottom: 8, shoes: 6, layer: 6 } as const;

/**
 * How far below the context band a single item may sit. Formality is judged per OUTFIT (slot-weighted mean);
 * per-item checks only keep absurd items out. Shoes get the most slack: judging them alone left a warm date with
 * zero shoes (sneakers are 2-4, the date band is 5-7).
 */
export const FORMALITY_SLACK = { top: 1, bottom: 1, shoes: 3, layer: 1 } as const;

/** Slot weights for the outfit's formality: what people read first counts most. */
export const SLOT_FORMALITY_WEIGHT = { top: 0.35, bottom: 0.35, shoes: 0.2, layer: 0.1 } as const;

/** The outfit's weighted formality may leave the context band by at most this much. */
export const OUTFIT_FORMALITY_TOLERANCE = 0.5;

/**
 * How far the day may go past an item's rated range before it is ruled out. Cold slack is larger: you can be a
 * little cool in the morning, but overheating all afternoon in the wrong trousers is worse.
 */
export const WEATHER_SLACK = { cold_c: 4, warm_c: 2 } as const;

/**
 * Garments that are only for warm days whatever their own rating says: the day's minimum must reach this.
 * don't touch / the sheet import rated some slides 5-40C, so item ranges alone put slides on a 5C morning.
 */
export const WARM_DAY_ONLY_MIN_C: Partial<Record<Subcategory, number>> = { shorts: 18, sandals: 18 };

/** MMR trade-off between score and novelty when picking the final candidates (Carbonell & Goldstein 1998). */
export const MMR_LAMBDA = 0.7;

/**
 * Default context rules (PRD section 7). The user edits these in onboarding and they
 * are stored per user; this is only the seed and the fallback.
 */
export const DEFAULT_CONTEXT_RULES: Record<ContextType, ContextRules> = {
  weekday: {
    type: "weekday",
    formality_range: [3, 6],
    top: { allow_subcategories: [], deny_subcategories: [], deny_patterns: [] },
    bottom: { allow_subcategories: [], deny_subcategories: [], deny_patterns: [] },
    shoes: { allow_subcategories: [], deny_subcategories: [], deny_patterns: [] },
    styling: "outfit",
    no_repeat_with_key: false,
  },
  shabbat: {
    type: "shabbat",
    formality_range: [7, 10],
    top: { allow_subcategories: ["button_down"], deny_subcategories: [], deny_patterns: ["print"] },
    bottom: { allow_subcategories: ["chinos", "trousers"], deny_subcategories: ["jeans", "shorts"], deny_patterns: [] },
    shoes: { allow_subcategories: ["dress_shoes", "boots"], deny_subcategories: ["sneakers", "sandals"], deny_patterns: [] },
    styling: "outfit",
    no_repeat_with_key: false,
  },
  holiday: {
    type: "holiday",
    formality_range: [7, 10],
    top: { allow_subcategories: ["button_down"], deny_subcategories: [], deny_patterns: ["print"] },
    bottom: { allow_subcategories: ["chinos", "trousers"], deny_subcategories: ["jeans", "shorts"], deny_patterns: [] },
    shoes: { allow_subcategories: ["dress_shoes", "boots"], deny_subcategories: ["sneakers", "sandals"], deny_patterns: [] },
    styling: "outfit",
    no_repeat_with_key: false,
  },
  reserve: {
    type: "reserve",
    formality_range: [1, 10],
    top: { allow_subcategories: ["tshirt"], deny_subcategories: [], deny_patterns: [] },
    bottom: { allow_subcategories: [], deny_subcategories: [], deny_patterns: [] },
    shoes: { allow_subcategories: [], deny_subcategories: [], deny_patterns: [] },
    styling: "packing_list",
    no_repeat_with_key: false,
  },
  date: {
    type: "date",
    formality_range: [5, 7],
    top: { allow_subcategories: ["button_down", "polo"], deny_subcategories: [], deny_patterns: ["print"] },
    bottom: { allow_subcategories: ["jeans", "chinos"], deny_subcategories: ["shorts"], deny_patterns: [] },
    shoes: { allow_subcategories: ["boots", "sneakers", "dress_shoes"], deny_subcategories: ["sandals"], deny_patterns: [], min_formality: 4 },
    styling: "outfit",
    no_repeat_with_key: true,
  },
  interview: {
    type: "interview",
    formality_range: [5, 9],
    top: { allow_subcategories: ["button_down", "polo"], deny_subcategories: [], deny_patterns: ["print"] },
    bottom: { allow_subcategories: ["chinos", "trousers", "jeans"], deny_subcategories: ["shorts"], deny_patterns: [] },
    shoes: { allow_subcategories: ["dress_shoes", "boots", "sneakers"], deny_subcategories: ["sandals"], deny_patterns: [], min_formality: 4 },
    styling: "outfit",
    no_repeat_with_key: false,
  },
  event: {
    type: "event",
    formality_range: [6, 9],
    top: { allow_subcategories: ["button_down"], deny_subcategories: [], deny_patterns: [] },
    bottom: { allow_subcategories: ["chinos", "trousers"], deny_subcategories: ["shorts"], deny_patterns: [] },
    shoes: { allow_subcategories: ["dress_shoes", "boots"], deny_subcategories: ["sandals", "sneakers"], deny_patterns: [] },
    styling: "outfit",
    no_repeat_with_key: false,
  },
  trip: {
    type: "trip",
    formality_range: [1, 10],
    top: { allow_subcategories: [], deny_subcategories: [], deny_patterns: [] },
    bottom: { allow_subcategories: [], deny_subcategories: [], deny_patterns: [] },
    shoes: { allow_subcategories: [], deny_subcategories: [], deny_patterns: [] },
    styling: "packing_list",
    no_repeat_with_key: false,
  },
};
