import { DEFAULT_CONTEXT_RULES, generateCandidates, pairKey, type PairWeights } from "@fit-check/engine";
import { StylingRequestSchema, type CandidateOutfit } from "@fit-check/schema";
import { MOCK_WARDROBE } from "../../mock/wardrobe";
// don't touch / session-1 mock only, same reason as mock/wardrobe.ts.
import pairWeightsJson from "../../../../../packages/engine/__fixtures__/pair-weights.json";

/** The mock "today". The engine is pure and takes the date as an argument, so the screen does too. */
export const MOCK_TODAY = "2026-11-06";

/**
 * Hardcoded until Hebcal is wired (CLAUDE.md: Hebrew dates come from Hebcal, never computed locally).
 * Value verified against Intl's Hebrew calendar for MOCK_TODAY.
 */
export const MOCK_HEBREW_DATE = { he: "כ״ו בחשוון ה׳תשפ״ז", en: "26 Cheshvan 5787" } as const;

export const MOCK_WEATHER = { temp_min_c: 16, temp_max_c: 24, rain_probability: 0.1 } as const;

const weights: PairWeights = new Map(
  (pairWeightsJson as Array<{ item_a: string; item_b: string; weight: number }>).map((p) => [
    pairKey(p.item_a, p.item_b),
    p.weight,
  ])
);

/**
 * The engine's top-ranked weekday outfit for the mock weather, or null when the filters leave nothing.
 * Null is a real state (empty wardrobe, extreme weather) and the screen renders the quiet empty text for it.
 */
export function getMockOutfit(): CandidateOutfit | null {
  const request = StylingRequestSchema.parse({
    today: MOCK_TODAY,
    context: DEFAULT_CONTEXT_RULES.weekday,
    weather: MOCK_WEATHER,
    recent_wears: [],
    anchor_item_id: null,
    max_candidates: 6,
  });
  return generateCandidates(MOCK_WARDROBE, request, weights)[0] ?? null;
}
