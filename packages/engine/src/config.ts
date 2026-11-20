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

/**
 * Shabbat and holiday colour preference for the top (Roy, 2026-11-19; DESIGN.md "שלב 4.1" item 7). Not a rule: a
 * white shirt is preferred, light colours and stripes pass without a penalty, dark colours and loud patterns lose a
 * little. Added to the weighted score of shabbat and holiday contexts only; every other context scores as before.
 * The bonus is smaller than one recently-worn item (RECENCY.item_penalty * 0.25 = 0.125), so a white shirt worn
 * yesterday does not come straight back.
 */
export const SHABBAT_COLOR = {
  contexts: ["shabbat", "holiday"] as readonly ContextType[],
  /** color_name "white". */
  white_top: 0.06,
  /** HSL lightness of color_hex below this reads as dark (navy #1F2A44 is 0.19, mid blue #3B5B8C 0.39). */
  dark_lightness: 0.3,
  dark_top: -0.03,
  /**
   * Patterns that read loud on a Shabbat shirt. The tag schema has one `stripes` value (no thin/wide), so stripes are
   * treated as the thin ones and stay neutral; `print` is already denied by the Shabbat context rules.
   */
  loud_patterns: ["check", "print"] as readonly string[],
  loud_top: -0.03,
} as const;

/**
 * "A date without a name" (PRD 7.1, DESIGN.md "שלב 4.5" item 5): a complete outfit (the same item ids) worn in any of
 * the last this many wears of a context whose rules set `no_repeat_with_key` (today only `date`) is not offered for
 * it again. Counted in wears of that context, newest first, whatever the dates.
 */
export const NO_REPEAT_LAST_WEARS = 3;

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
  /**
   * A pair of garments inside one saved outfit (DESIGN.md "שלב 5.2" item 8): two wears' worth. Saving says "this
   * works" once, with no day behind it, so it counts for less than a favourite and is never a habit on its own.
   */
  saved_pair_delta: 0.1,
  /**
   * The same pair inside a favourite outfit, instead of `saved_pair_delta` (never both): four wears' worth, "a few
   * wears". A whole favourite outfit adds 0.2 * 0.5 * pair_weight 0.2 = 0.02 to its score, far under one garment worn
   * yesterday (RECENCY.item_penalty * 0.25 = 0.125), so "worn recently" still wins. Small, but candidate scores are
   * often bunched, so between near-equal candidates it decides: a valid saved outfit is often the suggestion. It also
   * cancels two dislikes on a pair (disliked_pair_delta -0.1), a plain save one.
   */
  favorite_pair_delta: 0.2,
  /**
   * Bound of one learned pair weight, worn and saved together: a pair never goes past it however many wears and
   * saves it has. The DB column `pair_weights.weight` holds the worn part alone, inside the same bound.
   */
  max_pair_weight: 1,
} as const;

/**
 * One tap on "warmer"/"cooler" or "dressier"/"more casual" moves today's request by this much. Warmer means the
 * user wants warmer clothes, so the day is treated as colder, not the other way round.
 */
export const ADJUST_STEP = { temp_c: 3, formality: 1 } as const;

/**
 * A holiday for someone who does not keep Shabbat and holidays (the profile switch off, DESIGN.md "שלב 4.1" item 10):
 * weekday rules, "a bit more festive". Steps of the adjust sheet's "dressier", taken by default and shown as taken.
 */
export const FESTIVE_FORMALITY_STEPS = 1;

/**
 * Wears before a garment goes to the wash (Roy's rules, 2026-11-08). Counted since the item's last wash.
 * Button-downs get 3 because they are worn over an undershirt. Missing kinds (shoes, outerwear, belts) never go.
 */
export const LAUNDRY_AFTER_WEARS: Partial<Record<Subcategory, number>> = {
  tshirt: 1,
  polo: 1,
  button_down: 3,
  shorts: 2,
  sweatshirt: 3,
  knit: 4,
  overshirt: 4,
  chinos: 4,
  trousers: 4,
  jeans: 6,
};

/**
 * How far back worn outfits are read: freshness (RECENCY windows are inside this) and the learned personal
 * adjustment (PERSONAL_ADJUSTMENT) both use this window.
 */
export const RECENT_WEARS_DAYS = 30;

/**
 * Learning "I run cold" / "I dress up" from what was worn. Each worn outfit stores the adjustment it was chosen
 * under; when most of the recent ones lean the same way, that lean becomes the starting point for every day.
 * Capped at one step: a handful of odd days must never push the suggestions far.
 */
export const PERSONAL_ADJUSTMENT = { min_samples: 5, majority: 0.5, max_steps: 1 } as const;

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
    top: { allow_subcategories: [], deny_subcategories: [], deny_patterns: [], deny_materials: [], optional: false },
    bottom: { allow_subcategories: [], deny_subcategories: [], deny_patterns: [], deny_materials: [], optional: false },
    shoes: { allow_subcategories: [], deny_subcategories: [], deny_patterns: [], deny_materials: [], optional: false },
    styling: "outfit",
    no_repeat_with_key: false,
  },
  shabbat: {
    type: "shabbat",
    formality_range: [7, 10],
    top: { allow_subcategories: ["button_down"], deny_subcategories: [], deny_patterns: ["print"], deny_materials: [], optional: false },
    bottom: { allow_subcategories: ["chinos", "trousers"], deny_subcategories: ["jeans", "shorts"], deny_patterns: [], deny_materials: [], optional: false },
    shoes: { allow_subcategories: ["dress_shoes", "boots"], deny_subcategories: ["sneakers", "sandals"], deny_patterns: [], deny_materials: [], optional: false },
    styling: "outfit",
    no_repeat_with_key: false,
  },
  holiday: {
    type: "holiday",
    formality_range: [7, 10],
    top: { allow_subcategories: ["button_down"], deny_subcategories: [], deny_patterns: ["print"], deny_materials: [], optional: false },
    bottom: { allow_subcategories: ["chinos", "trousers"], deny_subcategories: ["jeans", "shorts"], deny_patterns: [], deny_materials: [], optional: false },
    shoes: { allow_subcategories: ["dress_shoes", "boots"], deny_subcategories: ["sneakers", "sandals"], deny_patterns: [], deny_materials: [], optional: false },
    styling: "outfit",
    no_repeat_with_key: false,
  },
  reserve: {
    type: "reserve",
    formality_range: [1, 10],
    top: { allow_subcategories: ["tshirt"], deny_subcategories: [], deny_patterns: [], deny_materials: [], optional: false },
    bottom: { allow_subcategories: [], deny_subcategories: [], deny_patterns: [], deny_materials: [], optional: false },
    shoes: { allow_subcategories: [], deny_subcategories: [], deny_patterns: [], deny_materials: [], optional: false },
    styling: "packing_list",
    no_repeat_with_key: false,
  },
  date: {
    type: "date",
    formality_range: [5, 7],
    top: { allow_subcategories: ["button_down", "polo"], deny_subcategories: [], deny_patterns: ["print"], deny_materials: [], optional: false },
    bottom: { allow_subcategories: ["jeans", "chinos"], deny_subcategories: ["shorts"], deny_patterns: [], deny_materials: [], optional: false },
    shoes: { allow_subcategories: ["boots", "sneakers", "dress_shoes"], deny_subcategories: ["sandals"], deny_patterns: [], deny_materials: [], optional: false, min_formality: 4 },
    styling: "outfit",
    no_repeat_with_key: true,
  },
  interview: {
    type: "interview",
    formality_range: [5, 9],
    top: { allow_subcategories: ["button_down", "polo"], deny_subcategories: [], deny_patterns: ["print"], deny_materials: [], optional: false },
    bottom: { allow_subcategories: ["chinos", "trousers", "jeans"], deny_subcategories: ["shorts"], deny_patterns: [], deny_materials: [], optional: false },
    shoes: { allow_subcategories: ["dress_shoes", "boots", "sneakers"], deny_subcategories: ["sandals"], deny_patterns: [], deny_materials: [], optional: false, min_formality: 4 },
    styling: "outfit",
    no_repeat_with_key: false,
  },
  event: {
    type: "event",
    formality_range: [6, 9],
    top: { allow_subcategories: ["button_down"], deny_subcategories: [], deny_patterns: [], deny_materials: [], optional: false },
    bottom: { allow_subcategories: ["chinos", "trousers"], deny_subcategories: ["shorts"], deny_patterns: [], deny_materials: [], optional: false },
    shoes: { allow_subcategories: ["dress_shoes", "boots"], deny_subcategories: ["sandals", "sneakers"], deny_patterns: [], deny_materials: [], optional: false },
    styling: "outfit",
    no_repeat_with_key: false,
  },
  trip: {
    type: "trip",
    formality_range: [1, 10],
    top: { allow_subcategories: [], deny_subcategories: [], deny_patterns: [], deny_materials: [], optional: false },
    bottom: { allow_subcategories: [], deny_subcategories: [], deny_patterns: [], deny_materials: [], optional: false },
    shoes: { allow_subcategories: [], deny_subcategories: [], deny_patterns: [], deny_materials: [], optional: false },
    styling: "packing_list",
    no_repeat_with_key: false,
  },
};

/**
 * Shoe materials not offered on Yom Kippur (PRD section 7, "יום כיפור"): leather and suede, and `unknown` too: only a
 * shoe known not to be leather is offered (independent verification, 19.11: a sneaker tagged "unknown" may be leather).
 */
export const YOM_KIPPUR_DENIED_SHOE_MATERIALS = ["leather", "suede", "unknown"] as const;

/**
 * Yom Kippur (PRD section 7, "יום כיפור", 19.11.2026): the holiday rules, except that no leather or suede shoe is
 * offered and any other shoe is (canvas sneakers included, whatever its formality); with none in the wardrobe the
 * outfit goes without shoes. The white-shirt preference applies as on Shabbat (SHABBAT_COLOR reads `type`).
 *
 * don't touch / `type` stays "holiday": ContextType mirrors the database enum `context_type`, and a Yom Kippur wear is
 * stored as a holiday. Yom Kippur is a rule set the planner picks by date, not a new context type.
 */
export const YOM_KIPPUR_RULES: ContextRules = {
  ...DEFAULT_CONTEXT_RULES.holiday,
  shoes: {
    allow_subcategories: [],
    deny_subcategories: [],
    deny_patterns: [],
    deny_materials: [...YOM_KIPPUR_DENIED_SHOE_MATERIALS],
    min_formality: 1,
    optional: true,
  },
};
