import type { CandidateOutfit, Item, Slot, StylingRequest } from "@fit-check/schema";
import { MMR_LAMBDA, OUTFIT_FORMALITY_TOLERANCE, PER_SLOT_LIMIT, SLOT_FORMALITY_WEIGHT } from "./config";
import { hardFilter, slotOf } from "./filters";
import { scoreOutfit, type PairWeights } from "./scoring";

/**
 * Stage 2: build and rank combinations. Pure; deterministic for the same inputs, whatever their order.
 *
 * 1. Pre-rank each slot by a cheap per-item score and keep a few per subcategory (round-robin), so the
 *    combinatorial step stays small without starving whole kinds of garment.
 * 2. Score every surviving combination and drop those whose weighted formality leaves the context band.
 * 3. Pick the final set with MMR so the stylist gets genuinely different options, not eight near-copies.
 *
 * Vector similarity (pgvector) is a caller concern: the Edge Function may pass an already-narrowed `items` list.
 */

function lastWornIndex(item: Item, req: StylingRequest): number {
  // recent_wears is most-recent-first; a lower index means worn more recently.
  const idx = req.recent_wears.findIndex((w) => w.item_ids.includes(item.id));
  // don't touch / a finite sentinel, not Infinity: Infinity - Infinity is NaN, which made the
  // sort comparator skip the id tiebreak for every never-worn pair and leak DB row order into results.
  return idx === -1 ? Number.MAX_SAFE_INTEGER : idx;
}

/** 0..1: how well one item suits the context on its own, and how long it has rested. */
function itemPrior(item: Item, req: StylingRequest): number {
  const [lo, hi] = req.context.formality_range;
  const center = (lo + hi) / 2;
  const half = Math.max(0.5, (hi - lo) / 2);
  const fit = Math.max(0, 1 - Math.abs(item.tags.formality - center) / (half + 2));
  const idx = lastWornIndex(item, req);
  const rested = idx === Number.MAX_SAFE_INTEGER ? 1 : Math.min(1, (idx + 1) / 7);
  return 0.65 * fit + 0.35 * rested;
}

/**
 * Keeps `limit` items, taking turns between subcategories (best subcategory first). Ranking by recency alone,
 * then id, used to fill all six top slots with T-shirts on a fresh account, so button-downs were never offered.
 */
function preRank(items: Item[], req: StylingRequest, limit: number): Item[] {
  const groups = new Map<string, Item[]>();
  for (const item of items) {
    const g = groups.get(item.tags.subcategory) ?? [];
    g.push(item);
    groups.set(item.tags.subcategory, g);
  }
  const byPrior = (a: Item, b: Item) => itemPrior(b, req) - itemPrior(a, req) || a.id.localeCompare(b.id);
  const ordered = [...groups.entries()]
    .map(([sub, g]) => ({ sub, g: g.sort(byPrior) }))
    .sort((a, b) => itemPrior(b.g[0]!, req) - itemPrior(a.g[0]!, req) || a.sub.localeCompare(b.sub));

  const out: Item[] = [];
  for (let round = 0; out.length < limit; round++) {
    let added = false;
    for (const { g } of ordered) {
      const next = g[round];
      if (next && out.length < limit) {
        out.push(next);
        added = true;
      }
    }
    if (!added) break;
  }
  return out;
}

function outfitId(items: Item[]): string {
  return items
    .map((i) => i.id)
    .sort()
    .join("+");
}

/** Slot-weighted mean formality: what people see first (top, bottom) counts more than shoes or a layer. */
export function outfitFormality(items: Item[]): number {
  let total = 0;
  let weight = 0;
  for (const item of items) {
    const slot = slotOf(item);
    if (!slot) continue;
    total += SLOT_FORMALITY_WEIGHT[slot] * item.tags.formality;
    weight += SLOT_FORMALITY_WEIGHT[slot];
  }
  return weight === 0 ? 0 : total / weight;
}

type Scored = { combo: Item[]; candidate: CandidateOutfit };

/** 0..~1.3: how much two outfits look alike (same pieces in the same slots, same palette). */
function similarity(a: Item[], b: Item[]): number {
  let sim = 0;
  for (const item of a) {
    const slot = slotOf(item);
    if (slot && b.some((o) => o.id === item.id)) sim += SLOT_FORMALITY_WEIGHT[slot];
  }
  const palette = (o: Item[]) =>
    o
      .map((i) => i.tags.color_name)
      .sort()
      .join(",");
  if (palette(a) === palette(b)) sim += 0.3;
  return sim;
}

/**
 * Maximal Marginal Relevance: each pick trades its own score against its similarity to what is already chosen.
 * Two candidates may never share both top and bottom (the user would read them as the same outfit).
 */
function selectDiverse(scored: Scored[], count: number): CandidateOutfit[] {
  const chosen: Scored[] = [];
  const pairKeys = new Set<string>();
  const topBottom = (s: Scored) =>
    s.candidate.items
      .filter((i) => i.slot === "top" || i.slot === "bottom")
      .map((i) => i.id)
      .sort()
      .join("+");

  const pool = [...scored];
  while (chosen.length < count && pool.length > 0) {
    let bestIdx = -1;
    let best = -Infinity;
    for (let i = 0; i < pool.length; i++) {
      const s = pool[i]!;
      if (pairKeys.has(topBottom(s))) continue;
      const maxSim = chosen.reduce((m, c) => Math.max(m, similarity(s.combo, c.combo)), 0);
      const mmr = MMR_LAMBDA * s.candidate.score - (1 - MMR_LAMBDA) * maxSim;
      // Ties break on outfit_id so the result never depends on input order.
      if (mmr > best || (mmr === best && bestIdx >= 0 && s.candidate.outfit_id < pool[bestIdx]!.candidate.outfit_id)) {
        best = mmr;
        bestIdx = i;
      }
    }
    if (bestIdx === -1) break;
    const [pick] = pool.splice(bestIdx, 1);
    chosen.push(pick!);
    pairKeys.add(topBottom(pick!));
  }
  return chosen.map((c) => c.candidate);
}

export function generateCandidates(items: Item[], req: StylingRequest, weights: PairWeights): CandidateOutfit[] {
  const bySlot = hardFilter(items, req);

  let tops = preRank(bySlot.top, req, PER_SLOT_LIMIT.top);
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
  const bottoms = bySlot.bottom.length === 1 ? bySlot.bottom : preRank(bySlot.bottom, req, PER_SLOT_LIMIT.bottom);
  const shoes = bySlot.shoes.length === 1 ? bySlot.shoes : preRank(bySlot.shoes, req, PER_SLOT_LIMIT.shoes);
  const layers: Array<Item | null> =
    bySlot.layer.length === 0 ? [null] : bySlot.layer.length === 1 ? bySlot.layer : preRank(bySlot.layer, req, PER_SLOT_LIMIT.layer);

  const [lo, hi] = req.context.formality_range;
  const scored: Scored[] = [];
  for (const t of tops) {
    for (const b of bottoms) {
      for (const s of shoes) {
        for (const l of layers) {
          const combo = l ? [t, b, s, l] : [t, b, s];
          // The band is enforced on the whole outfit: a casual shoe is fine under a formal shirt and trousers.
          const f = outfitFormality(combo);
          if (f < lo - OUTFIT_FORMALITY_TOLERANCE || f > hi + OUTFIT_FORMALITY_TOLERANCE) continue;
          const { score, ...breakdown } = scoreOutfit(combo, req, weights);
          scored.push({
            combo,
            candidate: {
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
            },
          });
        }
      }
    }
  }

  scored.sort((a, b) => b.candidate.score - a.candidate.score || a.candidate.outfit_id.localeCompare(b.candidate.outfit_id));
  return selectDiverse(scored, req.max_candidates);
}
