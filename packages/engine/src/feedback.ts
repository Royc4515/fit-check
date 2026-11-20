import { FEEDBACK } from "./config";
import { pairKey, type PairWeights } from "./scoring";

export type Feedback = "worn" | "skipped" | "disliked";

/** One pair weight after feedback. `a < b`, matching the `pair_weights_ordered` check in the DB. */
export type PairUpdate = { a: string; b: string; weight: number };

const DELTA: Record<Feedback, number> = {
  worn: FEEDBACK.worn_pair_delta,
  disliked: FEEDBACK.disliked_pair_delta,
  // A skip says "not today", not "these clash"; learning from it would punish weather or mood.
  skipped: 0,
};

/** The column is numeric(4,3): rounding here keeps the in-memory map equal to what the DB stores. */
const round3 = (n: number) => Math.round(n * 1000) / 1000;

/**
 * The pair-weight changes one piece of feedback causes (PRD 4: worn +0.05, disliked -0.1, clamped to -1..1).
 * Every unordered pair of distinct items in the outfit moves once. Pairs already at the bound are omitted, so the
 * caller never writes a no-op row.
 *
 * `sign` = -1 reverses an earlier call (undo). Reversal is exact except when the first call was clipped at a bound,
 * which needs 20 consecutive wears of the same pair and is accepted.
 */
export function feedbackUpdates(itemIds: readonly string[], feedback: Feedback, weights: PairWeights, sign: 1 | -1 = 1): PairUpdate[] {
  const delta = DELTA[feedback] * sign;
  if (delta === 0) return [];
  const ids = [...new Set(itemIds)].sort();
  const out: PairUpdate[] = [];
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      const a = ids[i]!;
      const b = ids[j]!;
      const old = weights.get(pairKey(a, b)) ?? 0;
      const weight = round3(Math.max(-FEEDBACK.max_pair_weight, Math.min(FEEDBACK.max_pair_weight, old + delta)));
      if (weight !== old) out.push({ a, b, weight });
    }
  }
  return out;
}

/** A new map with the updates applied; the input is never mutated (it is React state upstream). */
export function applyPairUpdates(weights: PairWeights, updates: readonly PairUpdate[]): PairWeights {
  const next = new Map(weights);
  for (const u of updates) next.set(pairKey(u.a, u.b), u.weight);
  return next;
}
