import { describe, expect, it } from "vitest";
import { ItemSchema, StylingRequestSchema, type CandidateOutfit, type Item, type StylingRequest } from "@fit-check/schema";
import wardrobeJson from "../__fixtures__/wardrobe.json";
import pairWeightsJson from "../__fixtures__/pair-weights.json";
import { DEFAULT_CONTEXT_RULES, FEEDBACK, SCORING_WEIGHTS } from "./config";
import { generateCandidates } from "./candidates";
import { hardFilter } from "./filters";
import { savedPairBonus, withSavedPairs, type SavedOutfitSignal } from "./saved";
import { pairKey, pairScore, scoreOutfit, type PairWeights } from "./scoring";
import { swapOptions } from "./swap";

const wardrobe: Item[] = (wardrobeJson as unknown[]).map((row) => ItemSchema.parse(row));
const weights: PairWeights = new Map(
  (pairWeightsJson as Array<{ item_a: string; item_b: string; weight: number }>).map((p) => [pairKey(p.item_a, p.item_b), p.weight])
);
const byId = new Map(wardrobe.map((i) => [i.id, i]));

function request(overrides: Partial<StylingRequest> = {}): StylingRequest {
  return StylingRequestSchema.parse({
    today: "2026-11-06",
    context: DEFAULT_CONTEXT_RULES.weekday,
    weather: { temp_min_c: 16, temp_max_c: 24, rain_probability: 0.1 },
    recent_wears: [],
    anchor_item_id: null,
    max_candidates: 8,
    ...overrides,
  });
}

const ids = (c: CandidateOutfit) => c.items.map((i) => i.id);
const saved = (c: CandidateOutfit | string[], isFavorite = false): SavedOutfitSignal => ({
  itemIds: Array.isArray(c) ? c : ids(c),
  isFavorite,
});
/** Position of an outfit in the engine's answer, or Infinity when it is not offered. */
const rankOf = (out: CandidateOutfit[], id: string) => {
  const i = out.findIndex((c) => c.outfit_id === id);
  return i === -1 ? Infinity : i;
};

describe("config", () => {
  it("a favourite counts more than a save, a save more than one wear, all under the bound", () => {
    expect(FEEDBACK.favorite_pair_delta).toBeGreaterThan(FEEDBACK.saved_pair_delta);
    expect(FEEDBACK.saved_pair_delta).toBeGreaterThan(FEEDBACK.worn_pair_delta);
    expect(FEEDBACK.favorite_pair_delta).toBeLessThan(FEEDBACK.max_pair_weight);
  });
});

describe("savedPairBonus", () => {
  it("gives every unordered pair of one saved outfit the saved delta", () => {
    const bonus = savedPairBonus([saved(["a", "b", "c"])]);
    expect([...bonus.entries()].sort()).toEqual([
      [pairKey("a", "b"), FEEDBACK.saved_pair_delta],
      [pairKey("a", "c"), FEEDBACK.saved_pair_delta],
      [pairKey("b", "c"), FEEDBACK.saved_pair_delta],
    ]);
  });

  it("a favourite gets the favourite delta instead of the saved one, not both", () => {
    const bonus = savedPairBonus([saved(["a", "b"], true)]);
    expect(bonus.get(pairKey("a", "b"))).toBe(FEEDBACK.favorite_pair_delta);
  });

  it("a pair in several saved outfits takes the largest single bonus, not the sum", () => {
    const near = [saved(["a", "b", "s1"]), saved(["a", "b", "s2"]), saved(["a", "b", "s3"])];
    expect(savedPairBonus(near).get(pairKey("a", "b"))).toBe(FEEDBACK.saved_pair_delta);
    const withFav = [...near, saved(["a", "b", "s4"], true)];
    expect(savedPairBonus(withFav).get(pairKey("a", "b"))).toBe(FEEDBACK.favorite_pair_delta);
    // Order does not matter: the favourite first gives the same.
    expect(savedPairBonus([...withFav].reverse()).get(pairKey("a", "b"))).toBe(FEEDBACK.favorite_pair_delta);
  });

  it("ignores duplicate ids and outfits with fewer than two garments", () => {
    expect(savedPairBonus([saved(["a", "a"]), saved(["b"]), saved([])]).size).toBe(0);
    expect(savedPairBonus([saved(["a", "b", "a"])]).size).toBe(1);
  });
});

describe("withSavedPairs", () => {
  it("returns the same map for no saved outfits, an empty list, or outfits with no pairs", () => {
    expect(withSavedPairs(weights, undefined)).toBe(weights);
    expect(withSavedPairs(weights, [])).toBe(weights);
    expect(withSavedPairs(weights, [saved(["105"])])).toBe(weights);
  });

  it("adds the bonus to the learned weight and never mutates the input", () => {
    const learned: PairWeights = new Map([[pairKey("a", "b"), 0.3]]);
    const out = withSavedPairs(learned, [saved(["a", "b", "c"], true)]);
    expect(out.get(pairKey("a", "b"))).toBe(0.5);
    expect(out.get(pairKey("a", "c"))).toBe(FEEDBACK.favorite_pair_delta);
    expect(learned.get(pairKey("a", "b"))).toBe(0.3);
    expect(learned.size).toBe(1);
  });

  it("is bounded after the addition: worn and saved together never pass the bound wears alone have", () => {
    const learned: PairWeights = new Map([
      [pairKey("a", "b"), 0.95],
      [pairKey("a", "c"), 1],
    ]);
    const out = withSavedPairs(learned, [saved(["a", "b", "c"], true)]);
    expect(out.get(pairKey("a", "b"))).toBe(FEEDBACK.max_pair_weight);
    expect(out.get(pairKey("a", "c"))).toBe(FEEDBACK.max_pair_weight);
  });

  it("a disliked pair inside a saved outfit is softened, not flipped", () => {
    const learned: PairWeights = new Map([[pairKey("a", "b"), -0.5]]);
    expect(withSavedPairs(learned, [saved(["a", "b"])]).get(pairKey("a", "b"))).toBe(-0.4);
  });
});

describe("saved outfits on the fixture wardrobe", () => {
  const req = request();
  const before = generateCandidates(wardrobe, req, weights);

  it("no saved outfits or an empty list: the same candidates and scores as before, to the byte", () => {
    expect(JSON.stringify(generateCandidates(wardrobe, req, withSavedPairs(weights, undefined)))).toBe(JSON.stringify(before));
    expect(JSON.stringify(generateCandidates(wardrobe, req, withSavedPairs(weights, [])))).toBe(JSON.stringify(before));
    const shabbat = request({ context: DEFAULT_CONTEXT_RULES.shabbat });
    expect(JSON.stringify(generateCandidates(wardrobe, shabbat, withSavedPairs(weights, [])))).toBe(
      JSON.stringify(generateCandidates(wardrobe, shabbat, weights))
    );
  });

  it("raises an outfit measurably and monotonically: favourite >= saved >= none", () => {
    const last = before.at(-1)!;
    const asSaved = generateCandidates(wardrobe, req, withSavedPairs(weights, [saved(last)]));
    const asFav = generateCandidates(wardrobe, req, withSavedPairs(weights, [saved(last, true)]));
    const score = (out: CandidateOutfit[]) => out.find((c) => c.outfit_id === last.outfit_id)!.score;

    // No pair of it was learned before, so every pair gets exactly the delta, the mean pair weight is the delta, and
    // the score moves by delta / 2 * the pair weight's share (pair_weight -1..1 is mapped to 0..1).
    expect(last.breakdown.pair_weight).toBe(0);
    expect(score(asSaved) - last.score).toBeCloseTo((FEEDBACK.saved_pair_delta / 2) * SCORING_WEIGHTS.pair_weight, 6);
    expect(score(asFav) - last.score).toBeCloseTo((FEEDBACK.favorite_pair_delta / 2) * SCORING_WEIGHTS.pair_weight, 6);

    expect(rankOf(asSaved, last.outfit_id)).toBeLessThanOrEqual(rankOf(before, last.outfit_id));
    expect(rankOf(asFav, last.outfit_id)).toBeLessThanOrEqual(rankOf(asSaved, last.outfit_id));
    // Measurably: the favourite moves the last of eight up.
    expect(rankOf(asFav, last.outfit_id)).toBeLessThan(rankOf(before, last.outfit_id));
  });

  it("is deterministic and does not depend on the order of the saved list or the wardrobe", () => {
    const list = [saved(before[3]!), saved(before[5]!, true), saved(before[7]!)];
    const a = generateCandidates(wardrobe, req, withSavedPairs(weights, list));
    const b = generateCandidates([...wardrobe].reverse(), req, withSavedPairs(weights, [...list].reverse()));
    expect(b).toEqual(a);
  });

  it("raises the pair inside other outfits too: a saved outfit acts through its pairs", () => {
    const first = before[0]!;
    const top = first.items.find((i) => i.slot === "top")!.id;
    const bottom = first.items.find((i) => i.slot === "bottom")!.id;
    // A saved outfit of the top and bottom with some shoe; every candidate holding that top and bottom gains.
    const out = generateCandidates(wardrobe, req, withSavedPairs(weights, [saved([top, bottom, "no-such-shoe"], true)]));
    const same = out.find((c) => c.outfit_id === first.outfit_id)!;
    expect(same.breakdown.pair_weight).toBeGreaterThan(first.breakdown.pair_weight);
  });

  it("an id that is not in the wardrobe is ignored without throwing", () => {
    const real = before.at(-1)!;
    const withGhost = [saved([...ids(real), "deleted-garment"], true)];
    const withoutGhost = [saved([...ids(real)], true)];
    expect(() => generateCandidates(wardrobe, req, withSavedPairs(weights, withGhost))).not.toThrow();
    expect(generateCandidates(wardrobe, req, withSavedPairs(weights, withGhost))).toEqual(
      generateCandidates(wardrobe, req, withSavedPairs(weights, withoutGhost))
    );
    const allGhosts = [saved(["gone-1", "gone-2", "gone-3"], true)];
    expect(generateCandidates(wardrobe, req, withSavedPairs(weights, allGhosts))).toEqual(before);
  });
});

describe("a saved outfit never beats a rule", () => {
  /** A favourite of exactly these garments, saved as many times as it takes. */
  const favourite = (itemIds: string[]) => withSavedPairs(weights, [saved(itemIds, true), saved(itemIds)]);
  const offered = (out: CandidateOutfit[], id: string) => out.some((c) => c.items.some((i) => i.id === id));

  it("weather: a garment the day rules out is not offered, however favourite", () => {
    const hot = request({ weather: { temp_min_c: 27, temp_max_c: 35, rain_probability: 0 } });
    const cold = request({ weather: { temp_min_c: 8, temp_max_c: 14, rain_probability: 0.4 } });
    // A favourite made for a cold day: its layer (and anything else too warm) is gone on a hot one.
    const coldOutfit = generateCandidates(wardrobe, cold, weights)[0]!;
    const passHot = new Set(Object.values(hardFilter(wardrobe, hot)).flat().map((i) => i.id));
    const ruledOut = ids(coldOutfit).filter((id) => !passHot.has(id));
    expect(ruledOut.length).toBeGreaterThan(0);
    const out = generateCandidates(wardrobe, hot, favourite(ids(coldOutfit)));
    expect(out.length).toBeGreaterThan(0);
    for (const id of ruledOut) expect(offered(out, id)).toBe(false);
  });

  it("context: a favourite weekday outfit with sneakers and jeans brings neither back on Shabbat", () => {
    const sneakers = wardrobe.find((i) => i.tags.subcategory === "sneakers" && i.status === "active")!;
    const jeans = wardrobe.find((i) => i.tags.subcategory === "jeans" && i.status === "active")!;
    const shirt = wardrobe.find((i) => i.tags.subcategory === "button_down" && i.status === "active")!;
    const shabbat = request({ context: DEFAULT_CONTEXT_RULES.shabbat });
    const out = generateCandidates(wardrobe, shabbat, favourite([shirt.id, jeans.id, sneakers.id]));
    expect(out.length).toBeGreaterThan(0);
    expect(offered(out, sneakers.id)).toBe(false);
    expect(offered(out, jeans.id)).toBe(false);
    for (const c of out) {
      expect(c.items.every((i) => !["sneakers", "sandals", "jeans", "shorts"].includes(i.subcategory))).toBe(true);
    }
  });

  it("laundry and location: a favourite garment that is not at home is not offered, in candidates or swaps", () => {
    const fav = before0();
    const top = fav.items.find((i) => i.slot === "top")!.id;
    const away = wardrobe.map((i) => (i.id === top ? { ...i, availability: "laundry" as const } : i));
    const w = favourite(ids(fav));
    const out = generateCandidates(away, request(), w);
    expect(offered(out, top)).toBe(false);
    const current = out[0]!.items.map((i) => byId.get(i.id)!);
    expect(swapOptions(away, request(), w, current, "top", 10).map((i) => i.id)).not.toContain(top);
  });

  it("worn recently: a favourite outfit worn yesterday is not the first suggestion", () => {
    const fav = before0();
    const w = favourite(ids(fav));
    expect(generateCandidates(wardrobe, request(), w)[0]!.outfit_id).toBe(fav.outfit_id);
    const wornYesterday = request({ recent_wears: [{ date: "2026-11-05", item_ids: ids(fav), context_key: null }] });
    expect(generateCandidates(wardrobe, wornYesterday, w)[0]!.outfit_id).not.toBe(fav.outfit_id);
  });

  it("no repeat: a favourite worn on one of the last three dates is not offered for a date at all", () => {
    const date = request({ context: DEFAULT_CONTEXT_RULES.date });
    const fav = generateCandidates(wardrobe, date, weights)[0]!;
    const w = favourite(ids(fav));
    const lastDate = request({
      context: DEFAULT_CONTEXT_RULES.date,
      recent_wears: [{ date: "2026-10-01", item_ids: ids(fav), context_key: null, context_type: "date" }],
    });
    const out = generateCandidates(wardrobe, lastDate, w);
    expect(out.length).toBeGreaterThan(0);
    expect(out.some((c) => c.outfit_id === fav.outfit_id)).toBe(false);
  });

  it("the bonus is too small to outweigh one garment worn yesterday", () => {
    const fav = before0();
    const items = ids(fav).map((id) => byId.get(id)!);
    const w = favourite(ids(fav));
    const gain = scoreOutfit(items, request(), w).score - scoreOutfit(items, request(), weights).score;
    const oneWorn = request({ recent_wears: [{ date: "2026-11-05", item_ids: [ids(fav)[0]!], context_key: null }] });
    const loss = scoreOutfit(items, request(), weights).score - scoreOutfit(items, oneWorn, weights).score;
    expect(gain).toBeGreaterThan(0);
    expect(gain).toBeLessThan(loss);
    expect(pairScore(items, w)).toBeCloseTo(FEEDBACK.favorite_pair_delta, 6);
  });
});

/** The engine's own first weekday suggestion on the fixture, with no saved outfits. */
function before0(): CandidateOutfit {
  return generateCandidates(wardrobe, request(), weights)[0]!;
}
