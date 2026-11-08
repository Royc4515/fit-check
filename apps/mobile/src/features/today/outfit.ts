import { DEFAULT_CONTEXT_RULES, generateCandidates, type PairWeights } from "@fit-check/engine";
import { StylingRequestSchema, type CandidateOutfit, type Item } from "@fit-check/schema";
import type { DayType } from "../../data/dayContext";
import { israelDate } from "../../data/dayContext";

type Weather = { temp_min_c: number; temp_max_c: number; rain_probability: number };

export type DayInput = { date: string; weather: Weather | null; dayType: DayType };

/**
 * Used only when no forecast is available (offline, rate-limited, first launch). Mild autumn day in the coastal
 * plain; the screen says "no weather data" whenever this is used, so the outfit is never presented as weather-aware.
 */
export const FALLBACK_WEATHER: Weather = { temp_min_c: 16, temp_max_c: 24, rain_probability: 0.1 };

function request(day: DayInput, overrides: { anchor_item_id?: string; max_candidates?: number; weather?: Weather } = {}) {
  return StylingRequestSchema.parse({
    today: day.date,
    // Holidays use the Shabbat rules (PRD section 7: shabbat / holiday share one row).
    context: DEFAULT_CONTEXT_RULES[day.dayType === "weekday" ? "weekday" : day.dayType],
    weather: day.weather ?? FALLBACK_WEATHER,
    recent_wears: [],
    anchor_item_id: null,
    max_candidates: 8,
    ...overrides,
  });
}

/** The engine's top outfit for the day, or null when the filters leave nothing (a real state, shown as empty). */
export function getOutfit(items: Item[], pairWeights: PairWeights, day: DayInput): CandidateOutfit | null {
  return generateCandidates(items, request(day), pairWeights)[0] ?? null;
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
  const weather = { temp_min_c: item.tags.temp_min_c, temp_max_c: item.tags.temp_max_c, rain_probability: 0 };
  const day: DayInput = { date: israelDate().date, weather, dayType: "weekday" };
  return generateCandidates(items, request(day, { anchor_item_id: itemId, max_candidates: max }), pairWeights)
    .filter((c) => c.items.some((i) => i.id === itemId))
    .slice(0, max);
}
