import { describe, expect, it } from "vitest";
import { ItemSchema, StylingRequestSchema, type Item, type StylingRequest } from "@fit-check/schema";
import wardrobeJson from "../__fixtures__/wardrobe.json";
import { DEFAULT_CONTEXT_RULES } from "./config";
import { generateCandidates } from "./candidates";
import { fitsWeather, slotOf } from "./filters";
import type { PairWeights } from "./scoring";

const wardrobe: Item[] = (wardrobeJson as unknown[]).map((row) => ItemSchema.parse(row));
const byId = new Map(wardrobe.map((i) => [i.id, i]));
const NONE: PairWeights = new Map();

function request(weather: StylingRequest["weather"]): StylingRequest {
  return StylingRequestSchema.parse({
    today: "2026-11-20",
    context: DEFAULT_CONTEXT_RULES.weekday,
    weather,
    recent_wears: [],
    anchor_item_id: null,
    max_candidates: 8,
  });
}

const MILD = { temp_min_c: 16, temp_max_c: 24, rain_probability: 0.1 };
const WARM = { temp_min_c: 22, temp_max_c: 30, rain_probability: 0 };
const COLD_RAIN = { temp_min_c: 7, temp_max_c: 12, rain_probability: 0.9 };

const itemsOf = (req: StylingRequest, k = 0) => generateCandidates(wardrobe, req, NONE)[k]!.items.map((p) => byId.get(p.id)!);

describe("fitsWeather", () => {
  it("every candidate the engine makes fits the weather it was made for", () => {
    for (const w of [MILD, WARM, COLD_RAIN]) {
      const req = request(w);
      for (const c of generateCandidates(wardrobe, req, NONE)) {
        expect(fitsWeather(c.items.map((p) => byId.get(p.id)!), wardrobe, req)).toBe(true);
      }
    }
  });

  it("a warm day's outfit is wrong on a cold rainy day (no layer, pieces too light)", () => {
    const outfit = itemsOf(request(WARM));
    expect(fitsWeather(outfit, wardrobe, request(COLD_RAIN))).toBe(false);
  });

  it("a cold day's layered outfit is wrong on a warm day (no layer is worn above the threshold)", () => {
    const outfit = itemsOf(request(COLD_RAIN));
    expect(outfit.some((i) => slotOf(i) === "layer")).toBe(true);
    expect(fitsWeather(outfit, wardrobe, request(WARM))).toBe(false);
  });

  it("a mild day's layered outfit still fits a much colder day: the layer and the slack cover it", () => {
    const outfit = itemsOf(request(MILD));
    expect(outfit.some((i) => slotOf(i) === "layer")).toBe(true);
    expect(fitsWeather(outfit, wardrobe, request(COLD_RAIN))).toBe(true);
  });

  it("rain alone is not a hard rule: the same temperatures with rain keep the outfit valid", () => {
    const outfit = itemsOf(request(MILD));
    expect(fitsWeather(outfit, wardrobe, request({ ...MILD, rain_probability: 1 }))).toBe(true);
  });

  it("a small temperature change inside the slack keeps the outfit valid", () => {
    const outfit = itemsOf(request(MILD));
    expect(fitsWeather(outfit, wardrobe, request({ temp_min_c: 15, temp_max_c: 23, rain_probability: 0.3 }))).toBe(true);
  });

  it("a cool day demands a layer only when the pool has one the hard filter accepts", () => {
    const noLayers = wardrobe.filter((i) => slotOf(i) !== "layer");
    const req = request({ temp_min_c: 17, temp_max_c: 24, rain_probability: 0 });
    const outfit = generateCandidates(noLayers, req, NONE)[0]!.items.map((p) => byId.get(p.id)!);
    expect(fitsWeather(outfit, noLayers, req)).toBe(true);
    expect(fitsWeather(outfit, wardrobe, req)).toBe(false);
  });
});
