import type { CandidateOutfit, Item, StylingRequest } from "@fit-check/schema";
import { RECENCY, SCORING_WEIGHTS } from "./config";

/** Stage 2: scoring one combination. All signals are 0..1 except recency, which is a penalty. */

export type PairWeights = Map<string, number>; // key: pairKey(a, b)

export function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

function hexToHsl(hex: string): { h: number; s: number; l: number } {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) * 60;
  else if (max === g) h = ((b - r) / d + 2) * 60;
  else h = ((r - g) / d + 4) * 60;
  return { h, s, l };
}

const NEUTRAL_NAMES: ReadonlySet<Item["tags"]["color_name"]> = new Set(["navy", "white", "black", "grey", "beige", "brown", "cream"]);

function isNeutral(item: Item): boolean {
  // Menswear neutrals are a known list, not a saturation threshold: navy (#1F2A44) has
  // saturation 0.37 and would otherwise count as "blue" and clash with greens and reds.
  if (NEUTRAL_NAMES.has(item.tags.color_name)) return true;
  const { s, l } = hexToHsl(item.tags.color_hex);
  return s < 0.25 || l < 0.15 || l > 0.9;
}

/**
 * Color harmony: neutrals go with everything; two saturated colors score by hue distance
 * (analogous or complementary are fine, 90-degree clashes are not).
 */
export function colorHarmony(items: Item[]): number {
  let total = 0;
  let pairs = 0;
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      pairs++;
      const a = items[i]!;
      const b = items[j]!;
      if (isNeutral(a) || isNeutral(b)) {
        total += 1;
        continue;
      }
      const dh = Math.abs(hexToHsl(a.tags.color_hex).h - hexToHsl(b.tags.color_hex).h);
      const dist = Math.min(dh, 360 - dh);
      // analogous (< 40) = 1, complementary (> 150) = 0.8, clash around 90 = 0.3
      total += dist < 40 ? 1 : dist > 150 ? 0.8 : dist < 70 ? 0.6 : 0.3;
    }
  }
  return pairs === 0 ? 1 : total / pairs;
}

/** 1 minus normalized std deviation of formality. A 9 shirt with 2 sneakers scores low. */
export function formalityConsistency(items: Item[]): number {
  const f = items.map((i) => i.tags.formality);
  const mean = f.reduce((a, b) => a + b, 0) / f.length;
  const variance = f.reduce((a, b) => a + (b - mean) ** 2, 0) / f.length;
  const sd = Math.sqrt(variance);
  // sd of 3 (e.g. 4/7/10) is already a visible mismatch; cap there.
  return Math.max(0, 1 - sd / 3);
}

/** How close the outfit's mean formality sits to the center of the context band. */
export function contextFit(items: Item[], req: StylingRequest): number {
  const [lo, hi] = req.context.formality_range;
  const center = (lo + hi) / 2;
  const half = Math.max(0.5, (hi - lo) / 2);
  const mean = items.reduce((a, i) => a + i.tags.formality, 0) / items.length;
  return Math.max(0, 1 - Math.abs(mean - center) / (half + 1));
}

function daysBetween(a: string, b: string): number {
  // Dates are ISO yyyy-mm-dd; Date.UTC avoids any local-timezone drift in tests.
  const [ay, am, ad] = a.split("-").map(Number) as [number, number, number];
  const [by, bm, bd] = b.split("-").map(Number) as [number, number, number];
  return Math.round((Date.UTC(ay, am - 1, ad) - Date.UTC(by, bm - 1, bd)) / 86_400_000);
}

/** Negative number: items worn recently and full outfits repeated recently. */
export function recencyPenalty(items: Item[], req: StylingRequest): number {
  let penalty = 0;
  const ids = new Set(items.map((i) => i.id));
  for (const wear of req.recent_wears) {
    const age = daysBetween(req.today, wear.date);
    if (age < 0) continue;
    const overlap = wear.item_ids.filter((id) => ids.has(id)).length;
    if (age <= RECENCY.item_window_days) penalty -= overlap * RECENCY.item_penalty;
    const sameOutfit = overlap === ids.size && wear.item_ids.length === ids.size;
    if (sameOutfit && age <= RECENCY.outfit_window_days) penalty -= RECENCY.outfit_penalty;
  }
  return penalty;
}

/**
 * Mean learned pair weight over all pairs in the outfit, in -1..1. Negative means the
 * user disliked these together; the sign must survive, so this is NOT clamped to 0.
 */
export function pairScore(items: Item[], weights: PairWeights): number {
  let total = 0;
  let pairs = 0;
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      pairs++;
      total += weights.get(pairKey(items[i]!.id, items[j]!.id)) ?? 0;
    }
  }
  return pairs === 0 ? 0 : Math.max(-1, Math.min(1, total / pairs));
}

export function scoreOutfit(items: Item[], req: StylingRequest, weights: PairWeights): CandidateOutfit["breakdown"] & { score: number } {
  const breakdown = {
    color_harmony: colorHarmony(items),
    formality_consistency: formalityConsistency(items),
    context_fit: contextFit(items, req),
    recency_penalty: recencyPenalty(items, req),
    pair_weight: pairScore(items, weights),
  };
  // pair_weight is -1..1; map to 0..1 so the weighted sum stays in range, and a disliked
  // pair (negative) pulls below the 0.5 "unknown" baseline instead of being floored to 0.
  const weighted =
    breakdown.color_harmony * SCORING_WEIGHTS.color_harmony +
    breakdown.formality_consistency * SCORING_WEIGHTS.formality_consistency +
    breakdown.context_fit * SCORING_WEIGHTS.context_fit +
    ((breakdown.pair_weight + 1) / 2) * SCORING_WEIGHTS.pair_weight;
  // Penalty is applied after weighting so a repeated outfit drops out regardless of how good it is.
  const score = Math.max(0, Math.min(1, weighted + breakdown.recency_penalty * 0.25));
  return { ...breakdown, score };
}
