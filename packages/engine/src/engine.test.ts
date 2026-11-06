import { describe, expect, it } from "vitest";
import { ItemSchema, StylingRequestSchema, type Item, type StylingRequest } from "@fit-check/schema";
import wardrobeJson from "../__fixtures__/wardrobe.json";
import pairWeightsJson from "../__fixtures__/pair-weights.json";
import { DEFAULT_CONTEXT_RULES } from "./config";
import { generateCandidates } from "./candidates";
import { hardFilter } from "./filters";
import { pairKey, recencyPenalty, type PairWeights } from "./scoring";

const wardrobe: Item[] = (wardrobeJson as unknown[]).map((row) => ItemSchema.parse(row));
const weights: PairWeights = new Map(
  (pairWeightsJson as Array<{ item_a: string; item_b: string; weight: number }>).map((p) => [pairKey(p.item_a, p.item_b), p.weight])
);

function request(overrides: Partial<StylingRequest> = {}): StylingRequest {
  return StylingRequestSchema.parse({
    today: "2026-11-06",
    context: DEFAULT_CONTEXT_RULES.weekday,
    weather: { temp_min_c: 16, temp_max_c: 24, rain_probability: 0.1 },
    recent_wears: [],
    anchor_item_id: null,
    max_candidates: 6,
    ...overrides,
  });
}

describe("fixture", () => {
  it("loads the real wardrobe with valid tags", () => {
    expect(wardrobe.length).toBeGreaterThan(90);
    expect(wardrobe.every((i) => i.tags.formality >= 1 && i.tags.formality <= 10)).toBe(true);
  });
});

describe("hard filter", () => {
  it("shabbat never returns sneakers, sandals, jeans or shorts", () => {
    const req = request({ context: DEFAULT_CONTEXT_RULES.shabbat });
    const bySlot = hardFilter(wardrobe, req);
    const subs = [...bySlot.bottom, ...bySlot.shoes].map((i) => i.tags.subcategory);
    expect(subs).not.toContain("sneakers");
    expect(subs).not.toContain("sandals");
    expect(subs).not.toContain("jeans");
    expect(subs).not.toContain("shorts");
    expect(bySlot.top.every((i) => i.tags.subcategory === "button_down")).toBe(true);
    expect(bySlot.top.length).toBeGreaterThan(0);
    expect(bySlot.bottom.length).toBeGreaterThan(0);
    expect(bySlot.shoes.length).toBeGreaterThan(0);
  });

  it("drops items that are not at home", () => {
    const away = wardrobe.map((i) => (i.id === "401" ? { ...i, availability: "away" as const } : i));
    const bySlot = hardFilter(away, request({ context: DEFAULT_CONTEXT_RULES.shabbat }));
    expect(bySlot.top.map((i) => i.id)).not.toContain("401");
  });

  it("has no layer slot on a hot day and a non-empty one on a cold day", () => {
    const hot = hardFilter(wardrobe, request({ weather: { temp_min_c: 25, temp_max_c: 34, rain_probability: 0 } }));
    expect(hot.layer).toHaveLength(0);
    const cold = hardFilter(wardrobe, request({ weather: { temp_min_c: 9, temp_max_c: 15, rain_probability: 0.5 } }));
    expect(cold.layer.length).toBeGreaterThan(0);
  });

  it("date context never includes printed tops or shorts", () => {
    const bySlot = hardFilter(wardrobe, request({ context: DEFAULT_CONTEXT_RULES.date }));
    expect(bySlot.top.every((i) => i.tags.pattern !== "print")).toBe(true);
    expect(bySlot.bottom.every((i) => i.tags.subcategory !== "shorts")).toBe(true);
  });
});

describe("candidates", () => {
  it("is deterministic for the same inputs", () => {
    const req = request();
    const a = generateCandidates(wardrobe, req, weights);
    const b = generateCandidates(wardrobe, req, weights);
    expect(a).toEqual(b);
  });

  it("never exceeds max_candidates and never repeats a top+bottom pair", () => {
    const out = generateCandidates(wardrobe, request({ max_candidates: 5 }), weights);
    expect(out.length).toBeLessThanOrEqual(5);
    const keys = out.map((c) =>
      c.items
        .filter((i) => i.slot === "top" || i.slot === "bottom")
        .map((i) => i.id)
        .sort()
        .join("+")
    );
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("every shabbat candidate is button-down + chinos/trousers + dress shoes/boots", () => {
    const out = generateCandidates(wardrobe, request({ context: DEFAULT_CONTEXT_RULES.shabbat }), weights);
    expect(out.length).toBeGreaterThan(0);
    for (const c of out) {
      const bySlot = Object.fromEntries(c.items.map((i) => [i.slot, i.subcategory]));
      expect(bySlot["top"]).toBe("button_down");
      expect(["chinos", "trousers"]).toContain(bySlot["bottom"]);
      expect(["dress_shoes", "boots"]).toContain(bySlot["shoes"]);
    }
  });

  it("anchors every candidate on the requested item", () => {
    const out = generateCandidates(wardrobe, request({ anchor_item_id: "401" }), weights);
    expect(out.length).toBeGreaterThan(0);
    expect(out.every((c) => c.items.some((i) => i.id === "401"))).toBe(true);
  });
});

describe("recency", () => {
  it("penalizes items worn in the last 3 days and a repeated full outfit", () => {
    const top = wardrobe.find((i) => i.id === "105")!;
    const bottom = wardrobe.find((i) => i.id === "201")!;
    const shoes = wardrobe.find((i) => i.id === "704")!;
    const outfit = [top, bottom, shoes];
    const fresh = request();
    expect(recencyPenalty(outfit, fresh)).toBe(0);

    const wornYesterday = request({ recent_wears: [{ date: "2026-11-05", item_ids: ["105"], context_key: null }] });
    expect(recencyPenalty(outfit, wornYesterday)).toBeLessThan(0);

    const repeated = request({ recent_wears: [{ date: "2026-10-30", item_ids: ["105", "201", "704"], context_key: null }] });
    expect(recencyPenalty(outfit, repeated)).toBeLessThan(recencyPenalty(outfit, wornYesterday) + 0.01);
  });

  it("a worn item ranks below an unworn equivalent", () => {
    const req = request();
    const before = generateCandidates(wardrobe, req, weights);
    const first = before[0]!;
    const wornReq = request({
      recent_wears: [{ date: "2026-11-05", item_ids: first.items.map((i) => i.id), context_key: null }],
    });
    const after = generateCandidates(wardrobe, wornReq, weights);
    expect(after[0]!.outfit_id).not.toBe(first.outfit_id);
  });
});
