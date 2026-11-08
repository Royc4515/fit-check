import { describe, expect, it } from "vitest";
import { ItemSchema, StylingRequestSchema, type CandidateOutfit, type Item, type StylingRequest } from "@fit-check/schema";
import wardrobeJson from "../__fixtures__/wardrobe.json";
import pairWeightsJson from "../__fixtures__/pair-weights.json";
import { DEFAULT_CONTEXT_RULES } from "./config";
import { generateCandidates } from "./candidates";
import { pairKey, type PairWeights } from "./scoring";

/**
 * Regressions found by the v2 algorithm review (docs/PLAN.md, A5). Each test names the user-visible failure it
 * guards against, so a red test reads as a bug report.
 */

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

const subcatsIn = (out: CandidateOutfit[], slot: string) =>
  new Set(out.flatMap((c) => c.items.filter((i) => i.slot === slot).map((i) => i.subcategory)));

describe("cold start (no wear history)", () => {
  it("considers button-downs, not only the T-shirts with the smallest ids", () => {
    const out = generateCandidates(wardrobe, request(), weights);
    expect(subcatsIn(out, "top").has("button_down")).toBe(true);
  });

  it("offers at least two kinds of bottoms", () => {
    const out = generateCandidates(wardrobe, request(), weights);
    expect(subcatsIn(out, "bottom").size).toBeGreaterThanOrEqual(2);
  });
});

describe("formality is judged per outfit, not per item", () => {
  it("a warm date still finds shoes (sneakers were cut by the 5-7 band one by one)", () => {
    const warm = { temp_min_c: 22, temp_max_c: 28, rain_probability: 0 };
    const out = generateCandidates(wardrobe, request({ context: DEFAULT_CONTEXT_RULES.date, weather: warm }), weights);
    expect(out.length).toBeGreaterThan(0);
  });

  it("every outfit's slot-weighted formality still lands near the context band", () => {
    for (const type of ["weekday", "date", "shabbat", "event", "interview"] as const) {
      const ctx = DEFAULT_CONTEXT_RULES[type];
      const [lo, hi] = ctx.formality_range;
      for (const c of generateCandidates(wardrobe, request({ context: ctx }), weights)) {
        const w: Record<string, number> = { top: 0.35, bottom: 0.35, shoes: 0.2, layer: 0.1 };
        const total = c.items.reduce((a, i) => a + (w[i.slot] ?? 0), 0);
        const mean = c.items.reduce((a, i) => a + (w[i.slot] ?? 0) * i.formality, 0) / total;
        expect(mean).toBeGreaterThanOrEqual(lo - 1);
        expect(mean).toBeLessThanOrEqual(hi + 1);
      }
    }
  });
});

describe("candidate set diversity", () => {
  it("no item appears in more than half of the candidates when its slot has alternatives", () => {
    const out = generateCandidates(wardrobe, request(), weights);
    const counts = new Map<string, number>();
    for (const c of out) for (const i of c.items) counts.set(i.id, (counts.get(i.id) ?? 0) + 1);
    for (const [id, n] of counts) {
      const slot = byId.get(id)!.tags.category;
      // Shoes and layers have few eligible items on some days; their reuse is unavoidable, not a bug.
      if (slot === "top" || slot === "bottom") expect(n).toBeLessThanOrEqual(Math.ceil(out.length / 2));
    }
  });

  it("returns the requested number of candidates when the wardrobe allows it", () => {
    expect(generateCandidates(wardrobe, request(), weights)).toHaveLength(8);
  });
});

describe("hard rules survive the rewrite", () => {
  it("shabbat: button-down, chinos/trousers, dress shoes/boots only", () => {
    const out = generateCandidates(wardrobe, request({ context: DEFAULT_CONTEXT_RULES.shabbat }), weights);
    expect(out.length).toBeGreaterThan(0);
    for (const c of out) {
      const s = Object.fromEntries(c.items.map((i) => [i.slot, i.subcategory]));
      expect(s["top"]).toBe("button_down");
      expect(["chinos", "trousers"]).toContain(s["bottom"]);
      expect(["dress_shoes", "boots"]).toContain(s["shoes"]);
    }
  });
});

describe("weather coherence (the base outfit is worn all day, morning included)", () => {
  const legsAndFeetForSummerOnly = new Set(["shorts", "sandals"]);

  it("a cool morning (16C) never gets shorts or sandals, even though they overlap the day's range", () => {
    for (const c of generateCandidates(wardrobe, request(), weights)) {
      for (const i of c.items) expect(legsAndFeetForSummerOnly.has(i.subcategory)).toBe(false);
    }
  });

  it("a hot day has no layer and may use shorts", () => {
    const hot = { temp_min_c: 26, temp_max_c: 33, rain_probability: 0 };
    const out = generateCandidates(wardrobe, request({ weather: hot }), weights);
    expect(out.length).toBeGreaterThan(0);
    expect(out.every((c) => c.items.every((i) => i.slot !== "layer"))).toBe(true);
    expect(subcatsIn(out, "bottom").has("shorts")).toBe(true);
  });

  it("a winter day (8-14C) still dresses you, with a layer over the top", () => {
    const cold = { temp_min_c: 8, temp_max_c: 14, rain_probability: 0.3 };
    const out = generateCandidates(wardrobe, request({ weather: cold }), weights);
    expect(out.length).toBeGreaterThan(0);
    expect(out.every((c) => c.items.some((i) => i.slot === "layer"))).toBe(true);
  });

  it("an item rated for at most 19C is not the base of a 24C afternoon", () => {
    for (const c of generateCandidates(wardrobe, request(), weights)) {
      for (const i of c.items) {
        if (i.slot === "layer") continue;
        expect(byId.get(i.id)!.tags.temp_max_c + 2).toBeGreaterThanOrEqual(24);
      }
    }
  });
});
