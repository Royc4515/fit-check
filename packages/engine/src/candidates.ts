import type { CandidateOutfit, Item, Slot, StylingRequest } from "@fit-check/schema";
import { PER_SLOT_LIMIT } from "./config";
import { hardFilter, slotOf } from "./filters";
import { scoreOutfit, type PairWeights } from "./scoring";

/**
 * Stage 2: build and rank combinations. Pure; deterministic for the same inputs.
 *
 * Per-slot pre-ranking uses "least recently worn first" so the combinatorial step
 * stays small (6^3 or 6^4) and naturally favors variety. Vector similarity (pgvector)
 * is a caller concern: the Edge Function may pass an already-narrowed `items` list.
 */

function lastWornIndex(item: Item, req: StylingRequest): number {
  // recent_wears is most-recent-first; a lower index means worn more recently.
  const idx = req.recent_wears.findIndex((w) => w.item_ids.includes(item.id));
  // don't touch / a finite sentinel, not Infinity: Infinity - Infinity is NaN, which made the
  // sort comparator skip the id tiebreak for every never-worn pair and leak DB row order into results.
  return idx === -1 ? Number.MAX_SAFE_INTEGER : idx;
}

function preRank(items: Item[], req: StylingRequest): Item[] {
  return [...items]
    .sort((a, b) => {
      const d = lastWornIndex(b, req) - lastWornIndex(a, req);
      // Stable tiebreak on id keeps the output deterministic across runs.
      return d !== 0 ? d : a.id.localeCompare(b.id);
    })
    .slice(0, PER_SLOT_LIMIT);
}

function outfitId(items: Item[]): string {
  return items
    .map((i) => i.id)
    .sort()
    .join("+");
}

export function generateCandidates(items: Item[], req: StylingRequest, weights: PairWeights): CandidateOutfit[] {
  const bySlot = hardFilter(items, req);

  let tops = preRank(bySlot.top, req);
  if (req.anchor_item_id) {
    const anchor = items.find((i) => i.id === req.anchor_item_id);
    // slotOf returns null for outerwear/accessories; an anchor there is ignored rather than
    // silently dropped from every candidate.
    const slot = anchor ? slotOf(anchor) : null;
    if (anchor && slot) {
      // The anchor replaces its whole slot so every candidate includes it, even if the hard
      // filter would have cut it: "build around this shirt" is an explicit override.
      if (slot === "top") tops = [anchor];
      else if (slot === "bottom") bySlot.bottom = [anchor];
      else if (slot === "shoes") bySlot.shoes = [anchor];
      else if (slot === "layer" && bySlot.layer.length > 0) bySlot.layer = [anchor];
    }
  }
  const bottoms = preRank(bySlot.bottom, req);
  const shoes = preRank(bySlot.shoes, req);
  const layers = bySlot.layer.length > 0 ? preRank(bySlot.layer, req) : [null];

  const scored: CandidateOutfit[] = [];
  for (const t of tops) {
    for (const b of bottoms) {
      for (const s of shoes) {
        for (const l of layers) {
          const combo = l ? [t, b, s, l] : [t, b, s];
          const { score, ...breakdown } = scoreOutfit(combo, req, weights);
          scored.push({
            outfit_id: outfitId(combo),
            items: combo.map((i) => ({
              id: i.id,
              slot: i.tags.category as Slot,
              name: i.name,
              subcategory: i.tags.subcategory,
              color_name: i.tags.color_name,
              formality: i.tags.formality,
            })),
            score,
            breakdown,
          });
        }
      }
    }
  }

  scored.sort((a, b) => b.score - a.score || a.outfit_id.localeCompare(b.outfit_id));

  // Diversity: never hand the stylist two candidates that share the same top AND bottom.
  const seen = new Set<string>();
  const diverse: CandidateOutfit[] = [];
  for (const c of scored) {
    const key = c.items
      .filter((i) => i.slot === "top" || i.slot === "bottom")
      .map((i) => i.id)
      .sort()
      .join("+");
    if (seen.has(key)) continue;
    seen.add(key);
    diverse.push(c);
    if (diverse.length >= req.max_candidates) break;
  }
  return diverse;
}
