import type { Item } from "@fit-check/schema";
import { SCORING_WEIGHTS } from "./config";
import { colorHarmony, formalityConsistency, pairScore, type PairWeights } from "./scoring";

/**
 * How well a garment goes with garments already chosen, with no day attached: the parts of `scoreOutfit` that are
 * about the garments themselves (colour harmony, formality consistency, the learned pair weights), weighted by the
 * same SCORING_WEIGHTS and renormalised to 0..1. Context fit and recency are left out on purpose: an outfit built by
 * hand is saved for any day, not suggested for today (DESIGN.md "שלב 5.2" item 5).
 * @param candidate - the garment being considered.
 * @param chosen - the garments already in the outfit (other slots). Empty = no signal: 0.5, the "unknown" baseline.
 * @param weights - learned pair weights; a missing pair counts as 0.
 */
export function compatibilityScore(candidate: Item, chosen: readonly Item[], weights: PairWeights): number {
  if (chosen.length === 0) return 0.5;
  const outfit = [...chosen, candidate];
  const w = SCORING_WEIGHTS;
  const total = w.color_harmony + w.formality_consistency + w.pair_weight;
  // pair_weight is -1..1; mapped to 0..1 exactly as scoreOutfit does, so a disliked pair sinks below the baseline.
  const weighted = colorHarmony(outfit) * w.color_harmony + formalityConsistency(outfit) * w.formality_consistency + ((pairScore(outfit, weights) + 1) / 2) * w.pair_weight;
  return weighted / total;
}

/**
 * Candidates for one slot ordered by how well each goes with the garments already chosen, best first. Deterministic:
 * equal scores keep the order they came in (the caller's order, e.g. the wardrobe's), so the same inputs always give
 * the same list. With nothing chosen the input order is returned unchanged.
 * Pure: no I/O, no clock. Never drops or adds a candidate.
 */
export function orderByCompatibility(candidates: readonly Item[], chosen: readonly Item[], weights: PairWeights): Item[] {
  if (chosen.length === 0) return [...candidates];
  return candidates
    .map((item, index) => ({ item, index, score: compatibilityScore(item, chosen, weights) }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((s) => s.item);
}
