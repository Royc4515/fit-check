import { describe, expect, it } from "vitest";
import { ItemSchema, StylingRequestSchema, type Item } from "@fit-check/schema";
import wardrobeJson from "../__fixtures__/wardrobe.json";
import { DEFAULT_CONTEXT_RULES } from "./config";
import { hardFilter, passesContextRules, slotOf } from "./filters";

const wardrobe: Item[] = (wardrobeJson as unknown[]).map((row) => ItemSchema.parse(row));
const shabbat = DEFAULT_CONTEXT_RULES.shabbat;

describe("passesContextRules", () => {
  it("keeps T-shirts, jeans, shorts, sneakers and sandals out of Shabbat", () => {
    const denied = new Set(["tshirt", "polo", "jeans", "shorts", "sneakers", "sandals"]);
    const leaked = wardrobe.filter((i) => denied.has(i.tags.subcategory) && passesContextRules(i, shabbat));
    expect(leaked.map((i) => i.name)).toEqual([]);
  });

  it("lets in formal enough button-downs, trousers and dress shoes", () => {
    const passing = wardrobe.filter((i) => passesContextRules(i, shabbat));
    const subs = new Set(passing.map((i) => i.tags.subcategory));
    expect(subs.has("button_down")).toBe(true);
    expect(subs.has("dress_shoes") || subs.has("boots")).toBe(true);
    expect(subs.has("trousers") || subs.has("chinos")).toBe(true);
  });

  it("does not constrain items outside the outfit slots (outerwear, accessories)", () => {
    const unslotted = wardrobe.filter((i) => slotOf(i) === null);
    expect(unslotted.length).toBeGreaterThan(0);
    expect(unslotted.every((i) => passesContextRules(i, shabbat))).toBe(true);
  });

  it("judges layers on formality only", () => {
    const base = wardrobe.find((i) => slotOf(i) === "layer");
    expect(base).toBeDefined();
    if (!base) return;
    const formal = { ...base, tags: { ...base.tags, pattern: "print" as const, formality: 7 } };
    const casual = { ...base, tags: { ...base.tags, formality: 3 } };
    expect(passesContextRules(formal, shabbat)).toBe(true);
    expect(passesContextRules(casual, shabbat)).toBe(false);
  });

  it("is exactly the context part of hardFilter: every item hardFilter admits passes it", () => {
    const req = StylingRequestSchema.parse({
      today: "2026-11-07",
      context: shabbat,
      weather: { temp_min_c: 10, temp_max_c: 18, rain_probability: 0 },
      recent_wears: [],
      anchor_item_id: null,
      max_candidates: 6,
    });
    const admitted = Object.values(hardFilter(wardrobe, req)).flat();
    expect(admitted.length).toBeGreaterThan(0);
    expect(admitted.every((i) => passesContextRules(i, shabbat))).toBe(true);
  });
});
