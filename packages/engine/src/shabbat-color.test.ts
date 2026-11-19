import { describe, expect, it } from "vitest";
import { ItemSchema, StylingRequestSchema, type Item, type StylingRequest } from "@fit-check/schema";
import wardrobeJson from "../__fixtures__/wardrobe.json";
import { DEFAULT_CONTEXT_RULES, SHABBAT_COLOR } from "./config";
import { generateCandidates } from "./candidates";
import { hardFilter } from "./filters";
import { scoreOutfit, shabbatColor } from "./scoring";

const wardrobe: Item[] = (wardrobeJson as unknown[]).map((row) => ItemSchema.parse(row));
const byId = (id: string) => wardrobe.find((i) => i.id === id)!;

function request(type: "weekday" | "shabbat" | "holiday"): StylingRequest {
  return StylingRequestSchema.parse({
    today: "2026-11-21",
    context: DEFAULT_CONTEXT_RULES[type],
    weather: { temp_min_c: 16, temp_max_c: 24, rain_probability: 0.1 },
    recent_wears: [],
    anchor_item_id: null,
    max_candidates: 8,
  });
}

// 401 is a white solid Oxford (formality 8). Its twin differs only in colour: navy, which the harmony score already
// counts as a neutral like white, so any score difference comes from the Shabbat term alone.
const white = byId("401");
const navy: Item = { ...white, id: "401-navy", name: "Navy twin", tags: { ...white.tags, color_name: "navy", color_hex: "#1F2A44" } };
const checked: Item = { ...white, id: "401-check", name: "Check twin", tags: { ...white.tags, color_name: "white", pattern: "check" } };
const lightBlue: Item = { ...white, id: "401-lb", name: "Light blue twin", tags: { ...white.tags, color_name: "light_blue", color_hex: "#9DB9D8" } };
const striped = byId("404"); // white stripes

describe("shabbatColor", () => {
  it("is zero on a weekday, for every item in the wardrobe", () => {
    const req = request("weekday");
    for (const item of [...wardrobe, navy, checked]) expect(shabbatColor([item], req)).toBe(0);
  });

  it("prefers white, leaves light colours and stripes neutral, and docks dark colours a little", () => {
    const req = request("shabbat");
    expect(shabbatColor([white], req)).toBe(SHABBAT_COLOR.white_top);
    expect(shabbatColor([striped], req)).toBe(SHABBAT_COLOR.white_top);
    expect(shabbatColor([lightBlue], req)).toBe(0);
    expect(shabbatColor([navy], req)).toBe(SHABBAT_COLOR.dark_top);
    expect(shabbatColor([checked], req)).toBeCloseTo(SHABBAT_COLOR.white_top + SHABBAT_COLOR.loud_top); // white, but check
    expect(shabbatColor([byId("411")], req)).toBe(SHABBAT_COLOR.dark_top + SHABBAT_COLOR.loud_top); // black check
    expect(shabbatColor([byId("416")], req)).toBe(SHABBAT_COLOR.loud_top); // mid blue check
  });

  it("holidays score like Shabbat", () => {
    expect(shabbatColor([white], request("holiday"))).toBe(SHABBAT_COLOR.white_top);
    expect(shabbatColor([navy], request("holiday"))).toBe(SHABBAT_COLOR.dark_top);
  });
});

describe("Shabbat ranking", () => {
  const req = request("shabbat");
  const filtered = hardFilter(wardrobe, req);
  const bottom = filtered.bottom[0]!;
  const shoes = filtered.shoes[0]!;
  const weights = new Map<string, number>();

  it("a white button-down outscores its otherwise equal navy twin on Shabbat", () => {
    const w = scoreOutfit([white, bottom, shoes], req, weights).score;
    const n = scoreOutfit([navy, bottom, shoes], req, weights).score;
    expect(w).toBeGreaterThan(n);
  });

  it("and outranks it among the engine's candidates", () => {
    const tops = new Set(["401", "401-navy"]);
    const pool = [...wardrobe.filter((i) => i.tags.category !== "top"), white, navy];
    expect(pool.filter((i) => tops.has(i.id))).toHaveLength(2);
    const first = generateCandidates(pool, req, weights)[0]!;
    expect(first.items.find((i) => i.slot === "top")?.id).toBe("401");
  });

  it("weekday scoring is unchanged: the twins tie", () => {
    const wk = request("weekday");
    expect(scoreOutfit([white, bottom, shoes], wk, weights)).toEqual(scoreOutfit([navy, bottom, shoes], wk, weights));
  });
});
