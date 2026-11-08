import { describe, expect, it } from "vitest";
import { ItemSchema, StylingRequestSchema, type Item, type StylingRequest } from "@fit-check/schema";
import wardrobeJson from "../__fixtures__/wardrobe.json";
import { adjustRequest, combineAdjustments, learnedAdjustment, NO_ADJUSTMENT, type DayAdjustment } from "./adjust";
import { DEFAULT_CONTEXT_RULES } from "./config";
import { generateCandidates, outfitFormality } from "./candidates";
import { applyPairUpdates, feedbackUpdates } from "./feedback";
import { slotOf } from "./filters";
import { pairKey, type PairWeights } from "./scoring";
import { swapOptions } from "./swap";

/** A6: the feedback loop (wear, dislike, undo), today's nudges, and swapping one piece. */

const wardrobe: Item[] = (wardrobeJson as unknown[]).map((row) => ItemSchema.parse(row));
const byId = new Map(wardrobe.map((i) => [i.id, i]));

function request(overrides: Partial<StylingRequest> = {}): StylingRequest {
  return StylingRequestSchema.parse({
    today: "2026-11-08",
    context: DEFAULT_CONTEXT_RULES.weekday,
    weather: { temp_min_c: 16, temp_max_c: 24, rain_probability: 0.1 },
    recent_wears: [],
    anchor_item_id: null,
    max_candidates: 8,
    ...overrides,
  });
}

describe("feedbackUpdates", () => {
  const empty: PairWeights = new Map();

  it("raises every pair of a worn outfit by 0.05, ordered a < b", () => {
    const ups = feedbackUpdates(["c", "a", "b"], "worn", empty);
    expect(ups).toEqual([
      { a: "a", b: "b", weight: 0.05 },
      { a: "a", b: "c", weight: 0.05 },
      { a: "b", b: "c", weight: 0.05 },
    ]);
  });

  it("lowers a disliked outfit's pairs by 0.1 and learns nothing from a skip", () => {
    expect(feedbackUpdates(["a", "b"], "disliked", empty)).toEqual([{ a: "a", b: "b", weight: -0.1 }]);
    expect(feedbackUpdates(["a", "b"], "skipped", empty)).toEqual([]);
  });

  it("clamps at 1 and omits pairs already at the bound", () => {
    expect(feedbackUpdates(["a", "b"], "worn", new Map([[pairKey("a", "b"), 0.98]]))).toEqual([{ a: "a", b: "b", weight: 1 }]);
    expect(feedbackUpdates(["a", "b"], "worn", new Map([[pairKey("a", "b"), 1]]))).toEqual([]);
  });

  it("is reversed exactly by sign -1 (undo), without float drift", () => {
    let w: PairWeights = new Map([[pairKey("a", "b"), 0.15]]);
    w = applyPairUpdates(w, feedbackUpdates(["a", "b", "c"], "worn", w));
    w = applyPairUpdates(w, feedbackUpdates(["a", "b", "c"], "worn", w, -1));
    expect(w.get(pairKey("a", "b"))).toBe(0.15);
    expect(w.get(pairKey("a", "c"))).toBe(0);
  });

  it("ignores a repeated id instead of pairing an item with itself", () => {
    expect(feedbackUpdates(["a", "a"], "worn", empty)).toEqual([]);
  });

  it("does not mutate the weights it was given", () => {
    const w: PairWeights = new Map();
    applyPairUpdates(w, feedbackUpdates(["a", "b"], "worn", w));
    expect(w.size).toBe(0);
  });

  it("a disliked combination drops out of the top spot the next day", () => {
    const req = request();
    const first = generateCandidates(wardrobe, req, new Map())[0]!;
    const ids = first.items.map((i) => i.id);
    let w: PairWeights = new Map();
    for (let n = 0; n < 5; n++) w = applyPairUpdates(w, feedbackUpdates(ids, "disliked", w));
    expect(generateCandidates(wardrobe, req, w)[0]!.outfit_id).not.toBe(first.outfit_id);
  });
});

describe("adjustRequest", () => {
  it("leaves the request untouched with no adjustment", () => {
    const req = request();
    expect(adjustRequest(req, NO_ADJUSTMENT)).toBe(req);
  });

  it("asks for warmer clothes by treating the day as colder, and adds a layer", () => {
    const req = request({ weather: { temp_min_c: 20, temp_max_c: 27, rain_probability: 0 } });
    const warm = adjustRequest(req, { temp_steps: 1, formality_steps: 0 });
    expect(warm.weather.temp_min_c).toBe(17);
    expect(generateCandidates(wardrobe, req, new Map())[0]!.items.some((i) => i.slot === "layer")).toBe(false);
    expect(generateCandidates(wardrobe, warm, new Map())[0]!.items.some((i) => i.slot === "layer")).toBe(true);
  });

  it("shifts the formality band without squashing it at the edges", () => {
    const req = request();
    expect(adjustRequest(req, { temp_steps: 0, formality_steps: 2 }).context.formality_range).toEqual([5, 8]);
    expect(adjustRequest(req, { temp_steps: 0, formality_steps: -9 }).context.formality_range).toEqual([1, 4]);
    expect(adjustRequest(req, { temp_steps: 0, formality_steps: 9 }).context.formality_range).toEqual([7, 10]);
  });

  it("dressier produces a more formal outfit than the default", () => {
    const req = request();
    const base = generateCandidates(wardrobe, req, new Map())[0]!;
    const dressy = generateCandidates(wardrobe, adjustRequest(req, { temp_steps: 0, formality_steps: 2 }), new Map())[0]!;
    const f = (o: typeof base) => outfitFormality(o.items.map((i) => byId.get(i.id)!));
    expect(f(dressy)).toBeGreaterThan(f(base));
  });
});

describe("swapOptions", () => {
  const req = request();
  const outfit = generateCandidates(wardrobe, req, new Map())[0]!.items.map((i) => byId.get(i.id)!);

  it("offers up to three other items of the same slot that pass today's filters", () => {
    const opts = swapOptions(wardrobe, req, new Map(), outfit, "top");
    expect(opts.length).toBe(3);
    const currentTop = outfit.find((i) => slotOf(i) === "top")!;
    for (const o of opts) {
      expect(slotOf(o)).toBe("top");
      expect(o.id).not.toBe(currentTop.id);
      expect(o.availability).toBe("home");
    }
  });

  it("never offers two that look the same (subcategory and colour)", () => {
    const opts = swapOptions(wardrobe, req, new Map(), outfit, "bottom");
    const looks = opts.map((o) => `${o.tags.subcategory}:${o.tags.color_name}`);
    expect(new Set(looks).size).toBe(looks.length);
  });

  it("keeps the swapped outfit inside the formality band", () => {
    const [lo, hi] = req.context.formality_range;
    for (const slot of ["top", "bottom", "shoes"] as const) {
      for (const o of swapOptions(wardrobe, req, new Map(), outfit, slot)) {
        const combo = [...outfit.filter((i) => slotOf(i) !== slot), o];
        expect(outfitFormality(combo)).toBeGreaterThanOrEqual(lo - 0.5);
        expect(outfitFormality(combo)).toBeLessThanOrEqual(hi + 0.5);
      }
    }
  });

  it("skips items in the laundry", () => {
    const first = swapOptions(wardrobe, req, new Map(), outfit, "top")[0]!;
    const washed = wardrobe.map((i) => (i.id === first.id ? { ...i, availability: "laundry" as const } : i));
    expect(swapOptions(washed, req, new Map(), outfit, "top").map((o) => o.id)).not.toContain(first.id);
  });

  it("returns nothing for a slot the outfit does not have", () => {
    const noLayer = outfit.filter((i) => slotOf(i) !== "layer");
    expect(swapOptions(wardrobe, req, new Map(), noLayer, "layer")).toEqual([]);
  });
});

describe("learnedAdjustment", () => {
  const warm: DayAdjustment = { temp_steps: 1, formality_steps: 0 };
  const none = NO_ADJUSTMENT;

  it("learns nothing from fewer than five worn outfits", () => {
    expect(learnedAdjustment([warm, warm, warm, warm])).toEqual(NO_ADJUSTMENT);
  });

  it("leans warmer when most recent outfits were worn warmer, capped at one step", () => {
    const hot = { temp_steps: 3, formality_steps: 0 };
    expect(learnedAdjustment([hot, hot, warm, none, warm])).toEqual({ temp_steps: 1, formality_steps: 0 });
  });

  it("needs a real majority: half is not enough", () => {
    expect(learnedAdjustment([warm, warm, warm, none, none, none])).toEqual(NO_ADJUSTMENT);
  });

  it("learns each axis on its own", () => {
    const casualWarm = { temp_steps: 1, formality_steps: -1 };
    const casual = { temp_steps: 0, formality_steps: -1 };
    expect(learnedAdjustment([casualWarm, casual, casual, casual, casualWarm])).toEqual({ temp_steps: 0, formality_steps: -1 });
  });

  it("is stable once learned: wearing under the lean without tapping keeps it", () => {
    // Totals are stored, so untapped wears under a learned +1 still read +1.
    const samples = [warm, warm, warm, warm, warm, warm];
    expect(learnedAdjustment(samples)).toEqual(warm);
    expect(combineAdjustments(learnedAdjustment(samples), { temp_steps: -1, formality_steps: 0 })).toEqual(NO_ADJUSTMENT);
  });
});
