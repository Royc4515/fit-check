import type { Item, SlotRule, StylingRequest } from "@fit-check/schema";
import type { Slot } from "@fit-check/schema";
import { LAYER_THRESHOLD_C } from "./config";

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

function passesWeather(item: Item, req: StylingRequest): boolean {
  // An item is wearable if its comfort band overlaps the day's band.
  // don't touch / overlap, not containment: a jacket rated 5-19C must survive a 15-24C day.
  return item.tags.temp_min_c <= req.weather.temp_max_c && item.tags.temp_max_c >= req.weather.temp_min_c;
}

function passesFormality(item: Item, req: StylingRequest): boolean {
  const [lo, hi] = req.context.formality_range;
  return item.tags.formality >= lo && item.tags.formality <= hi;
}

/**
 * Returns the wearable items grouped by slot. The `layer` slot is present only when the
 * day is cold enough; on hot days it is deleted entirely so no combination includes it.
 */
export function hardFilter(items: Item[], req: StylingRequest): Record<Slot, Item[]> {
  const out: Record<Slot, Item[]> = { top: [], bottom: [], shoes: [], layer: [] };
  const needsLayer = req.weather.temp_min_c < LAYER_THRESHOLD_C;

  for (const item of items) {
    if (item.status !== "active" || item.availability !== "home") continue;
    const slot = slotOf(item);
    if (!slot) continue;
    if (slot === "layer" && !needsLayer) continue;
    if (!passesWeather(item, req)) continue;
    // Layers are judged by the context's top rule for formality only, not by subcategory
    // whitelists, otherwise shabbat (button_down only) would forbid a sweater over it.
    if (slot === "layer") {
      if (!passesFormality(item, req) && item.tags.formality < req.context.formality_range[0] - 1) continue;
    } else {
      if (!passesFormality(item, req)) continue;
      const rule = req.context[slot];
      if (!passesSlotRule(item, rule)) continue;
    }
    out[slot].push(item);
  }
  return out;
}
