// Types for the generated engine bundle (engine.js), restated from packages/engine for Deno. Only what Edge
// Functions call; keep in step with packages/engine/src when a signature there changes.
import type { Item } from "../../../packages/schema/src/item.ts";
import type { ContextRules, ContextType, StylingRequest } from "../../../packages/schema/src/context.ts";
import type { CandidateOutfit } from "../../../packages/schema/src/stylist.ts";
import type { OpenMeteoHourly } from "../../../packages/schema/src/external.ts";

export type PairWeights = Map<string, number>;
export type PairUpdate = { a: string; b: string; weight: number };
export type Feedback = "worn" | "skipped" | "disliked";
export type DayWeather = {
  temp_min_c: number;
  temp_max_c: number;
  rain_probability: number;
  wind_max_kmh: number;
  uv_max: number;
  sky: string;
};

/** Today's manual nudges in taps; positive formality_steps = "dressier" (packages/engine/src/adjust.ts). */
export type DayAdjustment = { temp_steps: number; formality_steps: number };

/** One saved outfit as the engine learns from it (packages/engine/src/saved.ts). */
export type SavedOutfitSignal = { readonly itemIds: readonly string[]; readonly isFavorite: boolean };

export declare const DEFAULT_CONTEXT_RULES: Record<ContextType, ContextRules>;
/** Yom Kippur's rules: the holiday rules with no leather, suede or `unknown` shoes and an optional shoe slot. */
export declare const YOM_KIPPUR_RULES: ContextRules;
export declare const FESTIVE_FORMALITY_STEPS: number;
export declare const RECENT_WEARS_DAYS: number;
export declare function withSavedPairs(weights: PairWeights, saved: readonly SavedOutfitSignal[] | undefined): PairWeights;
export declare function adjustRequest(req: StylingRequest, adj: DayAdjustment): StylingRequest;
export declare function generateCandidates(items: Item[], req: StylingRequest, weights: PairWeights): CandidateOutfit[];
export declare function scoreOutfit(items: Item[], req: StylingRequest, weights: PairWeights): CandidateOutfit["breakdown"] & { score: number };
export declare function pairKey(a: string, b: string): string;
export declare function summarizeDay(forecast: OpenMeteoHourly, date: string): DayWeather | null;
export declare function feedbackUpdates(itemIds: readonly string[], feedback: Feedback, weights: PairWeights, sign?: 1 | -1): PairUpdate[];
export declare function dueForLaundry(items: readonly Item[], wearCounts: ReadonlyMap<string, number>): Item[];
