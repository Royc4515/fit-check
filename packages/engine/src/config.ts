import type { ContextRules, ContextType } from "@fit-check/schema";

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

/** How many top candidates per slot survive before combinatorial scoring. */
export const PER_SLOT_LIMIT = 6;

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
