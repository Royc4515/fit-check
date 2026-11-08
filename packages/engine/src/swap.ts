import type { Item, Slot, StylingRequest } from "@fit-check/schema";
import { OUTFIT_FORMALITY_TOLERANCE } from "./config";
import { outfitFormality } from "./candidates";
import { hardFilter, slotOf } from "./filters";
import { scoreOutfit, type PairWeights } from "./scoring";

/**
 * Up to `max` replacements for one slot of an outfit, best first. Each alternative is scored as the whole outfit
 * it would produce, so a shirt that is fine alone but clashes with these trousers ranks low.
 *
 * Only items that pass today's hard filters are offered, and the swapped outfit must stay inside the formality band
 * (same rule as generateCandidates). Alternatives that look the same as one already offered (same subcategory and
 * colour) are skipped: three navy chinos are one choice, not three.
 *
 * Returns [] when the slot is not in the outfit or nothing else qualifies; the UI says so instead of offering junk.
 */
export function swapOptions(items: Item[], req: StylingRequest, weights: PairWeights, current: Item[], slot: Slot, max = 3): Item[] {
  const rest = current.filter((i) => slotOf(i) !== slot);
  if (rest.length === current.length) return [];
  const currentIds = new Set(current.map((i) => i.id));
  const [lo, hi] = req.context.formality_range;

  const scored: Array<{ item: Item; score: number }> = [];
  for (const item of hardFilter(items, req)[slot]) {
    if (currentIds.has(item.id)) continue;
    const combo = [...rest, item];
    const f = outfitFormality(combo);
    if (f < lo - OUTFIT_FORMALITY_TOLERANCE || f > hi + OUTFIT_FORMALITY_TOLERANCE) continue;
    scored.push({ item, score: scoreOutfit(combo, req, weights).score });
  }
  scored.sort((a, b) => b.score - a.score || a.item.id.localeCompare(b.item.id));

  const out: Item[] = [];
  const looks = new Set<string>();
  for (const { item } of scored) {
    const look = `${item.tags.subcategory}:${item.tags.color_name}`;
    if (looks.has(look)) continue;
    looks.add(look);
    out.push(item);
    if (out.length === max) break;
  }
  return out;
}
