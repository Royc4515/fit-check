import { FEEDBACK } from "./config";
import { pairKey, type PairWeights } from "./scoring";

/**
 * What the engine needs of one saved outfit (DESIGN.md "שלב 5.2" item 8): its garments and whether it is a favourite.
 * The app's `SavedOutfit` already has this shape, so the caller passes its list as it is.
 */
export type SavedOutfitSignal = { readonly itemIds: readonly string[]; readonly isFavorite: boolean };

/** Same rounding as feedbackUpdates: a weight reads as the 3-decimal number the DB column would hold. */
const round3 = (n: number) => Math.round(n * 1000) / 1000;

/**
 * The bonus every pair of garments earns from the saved outfits: `saved_pair_delta` for a pair inside a saved outfit,
 * `favorite_pair_delta` inside a favourite (instead, not on top). A pair inside several saved outfits gets the largest
 * single bonus, not the sum: saving near-copies of one outfit (same shirt and trousers, three pairs of shoes) must not
 * make that shirt and those trousers outweigh months of wears.
 *
 * Duplicate ids inside one outfit count once; an outfit with fewer than two distinct ids adds nothing.
 */
export function savedPairBonus(saved: readonly SavedOutfitSignal[]): Map<string, number> {
  const bonus = new Map<string, number>();
  for (const outfit of saved) {
    const delta = outfit.isFavorite ? FEEDBACK.favorite_pair_delta : FEEDBACK.saved_pair_delta;
    const ids = [...new Set(outfit.itemIds)];
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const key = pairKey(ids[i]!, ids[j]!);
        bonus.set(key, Math.max(bonus.get(key) ?? 0, delta));
      }
    }
  }
  return bonus;
}

/**
 * The pair weights the engine scores with once the saved outfits are counted: the learned (worn and disliked) weight
 * plus the saved bonus (savedPairBonus), bounded by `FEEDBACK.max_pair_weight` AFTER the addition, so worn and saved
 * together never pass the bound that wears alone have.
 *
 * A saved outfit acts only through these pairs: it is never offered as it is, and the hard filters (weather, context,
 * laundry, location), the formality band and the no-repeat and recency rules all still run on every candidate. An id
 * that is not in the wardrobe (a deleted or archived garment) only adds a pair no candidate holds, so it changes
 * nothing and never throws.
 *
 * Pure. The result is computed from the list each time; nothing is stored, so removing an outfit from the collection
 * needs no "unlearn". Never write the result back as learned weights: it would bank the bonus as wears.
 *
 * @param weights The learned weights (`pair_weights` rows); never mutated.
 * @param saved The saved outfits; absent or empty returns `weights` itself, so a caller that passes none scores
 * exactly as before.
 * @returns A new map when there is any bonus, else the same `weights` instance.
 */
export function withSavedPairs(weights: PairWeights, saved: readonly SavedOutfitSignal[] | undefined): PairWeights {
  if (!saved || saved.length === 0) return weights;
  const bonus = savedPairBonus(saved);
  if (bonus.size === 0) return weights;
  const out = new Map(weights);
  const cap = FEEDBACK.max_pair_weight;
  for (const [key, add] of bonus) out.set(key, round3(Math.max(-cap, Math.min(cap, (weights.get(key) ?? 0) + add))));
  return out;
}
