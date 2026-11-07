import { DEFAULT_CONTEXT_RULES, generateCandidates, type PairWeights } from "@fit-check/engine";
import { StylingRequestSchema, type CandidateOutfit, type Item } from "@fit-check/schema";
import { MOCK_TODAY, MOCK_WEATHER } from "./mock";

type Weather = { temp_min_c: number; temp_max_c: number; rain_probability: number };

function request(overrides: { anchor_item_id?: string; max_candidates?: number; weather?: Weather } = {}) {
  return StylingRequestSchema.parse({
    today: MOCK_TODAY,
    context: DEFAULT_CONTEXT_RULES.weekday,
    weather: MOCK_WEATHER,
    recent_wears: [],
    anchor_item_id: null,
    max_candidates: 6,
    ...overrides,
  });
}

/**
 * The engine's top-ranked weekday outfit, or null when the filters leave nothing (empty wardrobe, extreme
 * weather). Null is a real state and the screen renders the quiet empty text for it. The context, date and
 * weather are still mock inputs; the wardrobe and pair weights are the user's real data.
 */
export function getOutfit(items: Item[], pairWeights: PairWeights): CandidateOutfit | null {
  return generateCandidates(items, request(), pairWeights)[0] ?? null;
}

/**
 * Up to `max` outfits built around one item, for the item screen's "goes with". Weather is set to the item's own
 * range: asking "what goes with this coat" against today's 20 degrees would hide it from everything.
 * Only outfits that really contain the anchor are returned, because the engine ignores anchors it has no slot
 * for (accessories, outerwear) and would otherwise hand back unrelated outfits.
 */
export function getOutfitsWith(items: Item[], pairWeights: PairWeights, itemId: string, max = 3): CandidateOutfit[] {
  const item = items.find((i) => i.id === itemId);
  if (!item) return [];
  const weather = { ...MOCK_WEATHER, temp_min_c: item.tags.temp_min_c, temp_max_c: item.tags.temp_max_c };
  return generateCandidates(items, request({ anchor_item_id: itemId, max_candidates: max, weather }), pairWeights)
    .filter((c) => c.items.some((i) => i.id === itemId))
    .slice(0, max);
}
