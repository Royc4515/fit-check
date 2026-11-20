import { describe, expect, it } from "vitest";
import { ItemSchema, type Item } from "@fit-check/schema";
import wardrobeJson from "../__fixtures__/wardrobe.json";
import { compatibilityScore, orderByCompatibility } from "./compatibility";
import { slotOf } from "./filters";
import { pairKey, type PairWeights } from "./scoring";

const wardrobe: Item[] = (wardrobeJson as unknown[]).map((row) => ItemSchema.parse(row));

function item(id: string, over: Partial<Item["tags"]>): Item {
  return ItemSchema.parse({
    id,
    name: id,
    brand: null,
    tags: {
      category: "shoes",
      subcategory: "sneakers",
      color_hex: "#1B1B1B",
      color_name: "black",
      secondary_color_hex: null,
      pattern: "solid",
      material: "cotton",
      fit: "regular",
      sleeve: "na",
      formality: 3,
      seasons: ["summer"],
      temp_min_c: 10,
      temp_max_c: 35,
      modesty_flags: [],
      style_tags: [],
      ...over,
    },
    status: "active",
    availability: "home",
    source: "photo",
    price: null,
    currency: null,
    purchased_at: null,
    cutout_path: null,
    notes: null,
  });
}

const top = item("top", { category: "top", subcategory: "polo", color_hex: "#1F2A44", color_name: "navy", sleeve: "short", formality: 4 });
const bottom = item("bottom", { category: "bottom", subcategory: "chinos", color_hex: "#C8B48A", color_name: "beige", formality: 4 });
const none: PairWeights = new Map();

describe("orderByCompatibility", () => {
  it("returns the candidates unchanged when nothing is chosen", () => {
    const shoes = wardrobe.filter((i) => slotOf(i) === "shoes");
    expect(orderByCompatibility(shoes, [], none).map((i) => i.id)).toEqual(shoes.map((i) => i.id));
  });

  it("puts the shoe of the same formality before a far one", () => {
    const sneakers = item("sneakers", { formality: 4 });
    const dress = item("dress", { subcategory: "dress_shoes", formality: 10 });
    expect(orderByCompatibility([dress, sneakers], [top, bottom], none).map((i) => i.id)).toEqual(["sneakers", "dress"]);
  });

  it("puts a clashing colour after a neutral one", () => {
    const neutral = item("neutral", { formality: 4, color_hex: "#FFFFFF", color_name: "white" });
    // Green against an orange-ish top: 90 degrees apart, the clash band.
    const orangeTop = item("orange", { category: "top", subcategory: "tshirt", color_hex: "#E07020", color_name: "orange", sleeve: "short", formality: 4 });
    const green = item("green", { formality: 4, color_hex: "#40C040", color_name: "green" });
    expect(orderByCompatibility([green, neutral], [orangeTop], none).map((i) => i.id)).toEqual(["neutral", "green"]);
  });

  it("lets the learned pair weights decide between two equal garments", () => {
    const a = item("a", { formality: 4 });
    const b = item("b", { formality: 4 });
    const weights: PairWeights = new Map([[pairKey("top", "b"), 0.8]]);
    expect(orderByCompatibility([a, b], [top], weights).map((i) => i.id)).toEqual(["b", "a"]);
    const disliked: PairWeights = new Map([[pairKey("top", "a"), -0.8]]);
    expect(orderByCompatibility([a, b], [top], disliked).map((i) => i.id)).toEqual(["b", "a"]);
  });

  it("keeps the input order between equal scores, and never drops or adds a candidate", () => {
    const twins = ["x3", "x1", "x2"].map((id) => item(id, { formality: 4 }));
    expect(orderByCompatibility(twins, [top, bottom], none).map((i) => i.id)).toEqual(["x3", "x1", "x2"]);
    const tops = wardrobe.filter((i) => slotOf(i) === "top");
    const chosen = wardrobe.filter((i) => slotOf(i) === "bottom").slice(0, 1);
    const ordered = orderByCompatibility(tops, chosen, none);
    expect(new Set(ordered.map((i) => i.id))).toEqual(new Set(tops.map((i) => i.id)));
    expect(ordered).toHaveLength(tops.length);
    expect(orderByCompatibility(tops, chosen, none)).toEqual(ordered);
  });
});

describe("compatibilityScore", () => {
  it("is the 0.5 baseline with nothing chosen and stays in 0..1", () => {
    expect(compatibilityScore(top, [], none)).toBe(0.5);
    for (const c of wardrobe.slice(0, 30)) {
      const s = compatibilityScore(c, [top, bottom], none);
      expect(s).toBeGreaterThanOrEqual(0);
      expect(s).toBeLessThanOrEqual(1);
    }
  });
});
