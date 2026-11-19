import {
  adjustRequest,
  DEFAULT_CONTEXT_RULES,
  generateCandidates,
  NO_ADJUSTMENT,
  scoreOutfit,
  slotOf,
  type DayAdjustment,
  type PairWeights,
} from "@fit-check/engine";
import { StylingRequestSchema, type CandidateOutfit, type Item, type Slot, type StylingRequest } from "@fit-check/schema";
import type { FeedbackHistory, RecentWear, TodayRecord } from "../../data/feedback";
import type { DayType } from "../../data/dayContext";
import { israelDate } from "../../data/localDate";

type Weather = { temp_min_c: number; temp_max_c: number; rain_probability: number };

/**
 * `festive`: a holiday planned by the weekday rules (the observance switch off); it starts one "dressier" step up
 * (plans.ts defaultAdjustment).
 */
export type DayInput = { date: string; weather: Weather | null; dayType: DayType; festive?: boolean };

/**
 * Used only when no forecast is available (offline, rate-limited, first launch). Mild autumn day in the coastal
 * plain; the screen says "no weather data" whenever this is used, so the outfit is never presented as weather-aware.
 */
export const FALLBACK_WEATHER: Weather = { temp_min_c: 16, temp_max_c: 24, rain_probability: 0.1 };

function request(
  day: DayInput,
  overrides: { anchor_item_id?: string; max_candidates?: number; weather?: Weather; recent_wears?: RecentWear[] } = {}
): StylingRequest {
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

/** Scores a hand-assembled outfit (worn, or swapped) exactly like the engine scores its own candidates. */
export function asCandidate(items: Item[], req: StylingRequest, pairWeights: PairWeights): CandidateOutfit {
  const { score, ...breakdown } = scoreOutfit(items, req, pairWeights);
  return {
    outfit_id: items
      .map((i) => i.id)
      .sort()
      .join("+"),
    items: items.map((i) => ({
      id: i.id,
      slot: i.tags.category as Slot,
      name: i.name,
      subcategory: i.tags.subcategory,
      color_name: i.tags.color_name,
      formality: i.tags.formality,
    })),
    score,
    breakdown,
  };
}

/** Item ids the user replaced in today's suggestion, by slot. Cleared whenever the suggestion itself changes. */
export type Swaps = Partial<Record<Slot, string>>;

export type TodayPlan =
  /** Already answered "wearing": show that outfit, nothing else to decide today. */
  | { kind: "worn"; outfit: CandidateOutfit; record: TodayRecord; req: StylingRequest }
  | {
      kind: "suggestion";
      outfit: CandidateOutfit;
      items: Item[];
      source: "daily" | "swap";
      req: StylingRequest;
      lastSkip: TodayRecord | null;
      /** Today's still-open candidates, best first: what the AI stylist chooses from. */
      candidates: CandidateOutfit[];
      /** True when `outfit` is the stylist's pick (and was not swapped since), so its explanation applies. */
      styled: boolean;
    }
  /** Every candidate was skipped, or the filters left nothing. */
  | { kind: "empty"; lastSkip: TodayRecord | null; req: StylingRequest };

const sameSet = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((id) => b.includes(id));

/**
 * Everything Today shows, from the wardrobe, the day, what the user already answered today, and the session's
 * nudges and swaps. Pure, so the screen and the tests agree on what "today" is.
 *
 * Skipped and disliked outfits are removed from today's candidates, so skipping reveals the next one; recent worn
 * outfits feed the engine's freshness penalty.
 */
export function planToday(args: {
  items: Item[];
  pairWeights: PairWeights;
  day: DayInput;
  history: FeedbackHistory;
  adjustment?: DayAdjustment;
  swaps?: Swaps;
  /** The AI stylist's choice among `candidates`; ignored when it is no longer open (skipped, filtered out). */
  preferredId?: string | null;
}): TodayPlan {
  const { items, pairWeights, day, history, adjustment = NO_ADJUSTMENT, swaps = {}, preferredId = null } = args;
  const req = adjustRequest(request(day, { recent_wears: history.recent }), adjustment);
  const byId = new Map(items.map((i) => [i.id, i]));

  const worn = [...history.today].reverse().find((r) => r.feedback === "worn");
  if (worn) {
    // An item deleted since (archived, gone) simply drops out of the picture rather than blanking it.
    const wornItems = worn.itemIds.flatMap((id) => byId.get(id) ?? []);
    if (wornItems.length > 0) return { kind: "worn", outfit: asCandidate(wornItems, req, pairWeights), record: worn, req };
  }

  const answered = history.today.filter((r) => r.feedback !== "worn").map((r) => r.itemIds);
  const lastSkip = [...history.today].reverse().find((r) => r.feedback !== "worn") ?? null;
  const open = generateCandidates(items, req, pairWeights).filter(
    (c) => !answered.some((ids) => sameSet(ids, c.items.map((i) => i.id)))
  );
  const preferred = preferredId ? open.find((c) => c.outfit_id === preferredId) : undefined;
  const next = preferred ?? open[0];
  if (!next) return { kind: "empty", lastSkip, req };

  let picked = next.items.flatMap((i) => byId.get(i.id) ?? []);
  let swapped = false;
  for (const [slot, id] of Object.entries(swaps) as [Slot, string][]) {
    const replacement = byId.get(id);
    if (!replacement || slotOf(replacement) !== slot || !picked.some((i) => slotOf(i) === slot)) continue;
    picked = picked.map((i) => (slotOf(i) === slot ? replacement : i));
    swapped = true;
  }
  const outfit = swapped ? asCandidate(picked, req, pairWeights) : next;
  return {
    kind: "suggestion",
    outfit,
    items: picked,
    source: swapped ? "swap" : "daily",
    req,
    lastSkip,
    candidates: open,
    styled: preferred !== undefined && !swapped,
  };
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
