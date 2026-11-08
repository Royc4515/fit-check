import type { Item, SlotRule, StylingRequest } from "@fit-check/schema";
import type { Slot } from "@fit-check/schema";
import { FORMALITY_SLACK, LAYER_THRESHOLD_C, WARM_DAY_ONLY_MIN_C, WEATHER_SLACK } from "./config";

/**
 * Stage 1: hard filters. Pure, no scoring. Whatever survives here is allowed to be
 * suggested; whatever is cut here can never be rescued by the LLM.
 */

export function slotOf(item: Item): Slot | null {
  switch (item.tags.category) {
    case "top":
      return "top";
    case "bottom":
      return "bottom";
    case "shoes":
      return "shoes";
    case "layer":
      return "layer";
    default:
      // outerwear and accessories are not part of the MVP outfit composition
      return null;
  }
}

function passesSlotRule(item: Item, rule: SlotRule): boolean {
  const sub = item.tags.subcategory;
  if (rule.allow_subcategories.length > 0 && !rule.allow_subcategories.includes(sub)) return false;
  if (rule.deny_subcategories.includes(sub)) return false;
  if (rule.deny_patterns.includes(item.tags.pattern)) return false;
  if (rule.min_formality !== undefined && item.tags.formality < rule.min_formality) return false;
  return true;
}

/**
 * Weather fit for one item. The base outfit (top, bottom, shoes) is worn all day, so it must cover the whole day:
 * not too cold for the morning, not too warm for the afternoon. A layer only needs to overlap the day, because it
 * comes off. With a layer on, the top no longer has to keep you warm by itself, only cool enough for the peak.
 *
 * don't touch / overlap-only (the v1 rule) let shorts and slides through on a 16-24C day (their range starts at 22C
 * but overlaps), producing "shorts + sweater". The slack values absorb the coarse sheet ranges (5/14/22 to 19/26/40).
 */
function passesWeather(item: Item, slot: Slot, req: StylingRequest, layered: boolean): boolean {
  const { temp_min_c: dayMin, temp_max_c: dayMax } = req.weather;
  const { temp_min_c: itemMin, temp_max_c: itemMax } = item.tags;
  if (slot === "layer") return itemMin <= dayMax && itemMax >= dayMin;
  const warmOnly = WARM_DAY_ONLY_MIN_C[item.tags.subcategory];
  if (warmOnly !== undefined && dayMin < warmOnly) return false;
  const warmEnoughForMorning = itemMin - WEATHER_SLACK.cold_c <= dayMin;
  const coolEnoughForAfternoon = itemMax + WEATHER_SLACK.warm_c >= dayMax;
  if (slot === "top" && layered) return coolEnoughForAfternoon;
  return warmEnoughForMorning && coolEnoughForAfternoon;
}

/**
 * Per-item formality is only a coarse gate (band minus the slot's slack); the real check is the outfit's weighted
 * mean in candidates.ts. Judging each item against the full band emptied whole slots (no shoes for a warm date).
 */
function passesFormality(item: Item, slot: Slot, req: StylingRequest): boolean {
  const [lo, hi] = req.context.formality_range;
  return item.tags.formality >= lo - FORMALITY_SLACK[slot] && item.tags.formality <= hi + 1;
}

/**
 * Returns the wearable items grouped by slot. The `layer` slot is present only when the
 * day is cold enough; on hot days it is deleted entirely so no combination includes it.
 */
export function hardFilter(items: Item[], req: StylingRequest): Record<Slot, Item[]> {
  const out: Record<Slot, Item[]> = { top: [], bottom: [], shoes: [], layer: [] };
  const needsLayer = req.weather.temp_min_c < LAYER_THRESHOLD_C;

  for (const item of items) {
    // A `virtual` item (pre-purchase check, PRD 4.5) is only admitted when it is the anchor;
    // otherwise virtual items would leak into the daily outfit.
    const isVirtualAnchor = item.status === "virtual" && item.id === req.anchor_item_id;
    if ((item.status !== "active" && !isVirtualAnchor) || item.availability !== "home") continue;
    const slot = slotOf(item);
    if (!slot) continue;
    if (slot === "layer" && !needsLayer) continue;
    if (!passesWeather(item, slot, req, needsLayer)) continue;
    if (!passesFormality(item, slot, req)) continue;
    // Layers are judged on formality only, not by subcategory whitelists; otherwise shabbat (button_down only)
    // would forbid a sweater over the shirt.
    if (slot !== "layer" && !passesSlotRule(item, req.context[slot])) continue;
    out[slot].push(item);
  }
  return out;
}
