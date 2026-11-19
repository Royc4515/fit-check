import { describe, expect, it } from "vitest";
import { ItemSchema, StylingRequestSchema, type Item, type StylingRequest } from "@fit-check/schema";
import wardrobeJson from "../__fixtures__/wardrobe.json";
import { DEFAULT_CONTEXT_RULES } from "./config";
import { generateCandidates } from "./candidates";

const wardrobe: Item[] = (wardrobeJson as unknown[]).map((row) => ItemSchema.parse(row));

function request(overrides: Partial<StylingRequest> = {}): StylingRequest {
  return StylingRequestSchema.parse({
    today: "2026-11-20",
    context: DEFAULT_CONTEXT_RULES.weekday,
    weather: { temp_min_c: 16, temp_max_c: 24, rain_probability: 0.1 },
    recent_wears: [],
    anchor_item_id: null,
    max_candidates: 8,
    ...overrides,
  });
}

// A wear can be recorded ahead for a later date (Friday records Shabbat's outfit, DESIGN.md "שלב 4.1"). For the
// day being planned it has not happened yet, so it must change nothing: not the score (recencyPenalty already
// skipped it) and not the pre-ranking either, which read recent_wears by position and ignored the date.
describe("a wear dated after req.today", () => {
  it("does not change today's candidates", () => {
    const plain = generateCandidates(wardrobe, request(), new Map());
    // The best outfit's own pieces, recorded for tomorrow: before the fix their pre-rank fell as if worn today.
    const ids = plain[0]!.items.map((i) => i.id);
    const future = request({ recent_wears: [{ date: "2026-11-21", item_ids: ids, context_key: null }] });
    expect(generateCandidates(wardrobe, future, new Map())).toEqual(plain);
  });

  it("while the same wear dated yesterday does", () => {
    const plain = generateCandidates(wardrobe, request(), new Map());
    const ids = plain[0]!.items.map((i) => i.id);
    const past = request({ recent_wears: [{ date: "2026-11-19", item_ids: ids, context_key: null }] });
    expect(generateCandidates(wardrobe, past, new Map())[0]!.outfit_id).not.toBe(plain[0]!.outfit_id);
  });
});
