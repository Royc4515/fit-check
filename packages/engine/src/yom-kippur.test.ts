import { describe, expect, it } from "vitest";
import { ItemSchema, StylingRequestSchema, type ContextRules, type Item } from "@fit-check/schema";
import wardrobeJson from "../__fixtures__/wardrobe.json";
import { DEFAULT_CONTEXT_RULES, YOM_KIPPUR_RULES } from "./config";
import { generateCandidates } from "./candidates";

const wardrobe: Item[] = (wardrobeJson as unknown[]).map((row) => ItemSchema.parse(row));
const MILD = { temp_min_c: 14, temp_max_c: 22, rain_probability: 0 };
const WARM = { temp_min_c: 22, temp_max_c: 31, rain_probability: 0 };
const run = (items: Item[], context: ContextRules, weather = MILD) =>
  generateCandidates(items, StylingRequestSchema.parse({ today: "2027-10-11", context, weather, recent_wears: [], anchor_item_id: null, max_candidates: 8 }), new Map());
// The fixture's only dress shoe (701) is tagged cotton after anonymising; the real one is leather. Retag it, and the
// boots, so the test has leather to refuse.
const leathered = wardrobe.map((i) => (i.id === "701" || i.id === "702" ? { ...i, tags: { ...i.tags, material: "leather" as const } } : i));

describe("Yom Kippur rules", () => {
  it("keep the holiday's type, so a wear is still stored as a holiday", () => {
    expect(YOM_KIPPUR_RULES.type).toBe("holiday");
    expect(YOM_KIPPUR_RULES.top).toEqual(DEFAULT_CONTEXT_RULES.holiday.top);
    expect(YOM_KIPPUR_RULES.bottom).toEqual(DEFAULT_CONTEXT_RULES.holiday.bottom);
  });

  it("never offer a leather or suede shoe", () => {
    const out = run(leathered, YOM_KIPPUR_RULES);
    expect(out.length).toBeGreaterThan(0);
    const leatheredById = new Map(leathered.map((i) => [i.id, i]));
    for (const c of out) {
      const shoes = c.items.filter((i) => i.slot === "shoes").map((i) => leatheredById.get(i.id)!);
      expect(shoes).toHaveLength(1);
      for (const s of shoes) expect(["leather", "suede"]).not.toContain(s.tags.material);
    }
    // The ordinary holiday, by contrast, offers the leather dress shoe.
    expect(run(leathered, DEFAULT_CONTEXT_RULES.holiday)[0]!.items.some((i) => i.id === "701")).toBe(true);
  });

  it("without any non-leather shoe: outfits without shoes, every other slot still there", () => {
    const allLeather = leathered.map((i) => (i.tags.category === "shoes" ? { ...i, tags: { ...i.tags, material: "leather" as const } } : i));
    const out = run(allLeather, YOM_KIPPUR_RULES);
    expect(out.length).toBeGreaterThan(0);
    for (const c of out) {
      expect(c.items.some((i) => i.slot === "shoes")).toBe(false);
      expect(c.items.some((i) => i.slot === "top")).toBe(true);
      expect(c.items.some((i) => i.slot === "bottom")).toBe(true);
      expect(c.items.some((i) => i.slot === "layer")).toBe(true); // 14 degrees: the layer is due
    }
    // A slot that is not optional still means no outfit at all.
    expect(run(allLeather, { ...YOM_KIPPUR_RULES, shoes: { ...YOM_KIPPUR_RULES.shoes, optional: false } })).toEqual([]);
  });

  it("the top keeps the Shabbat preference: white", () => {
    const top = run(leathered, YOM_KIPPUR_RULES)[0]!.items.find((i) => i.slot === "top")!;
    expect(top.color_name).toBe("white");
  });
});

// Outfit ids for a fixed fixture, recorded before the Yom Kippur change (deny_materials, optional slots, a slot's own
// formality floor): Shabbat, holidays and the other rule sets must come out exactly the same.
const BEFORE: Record<string, string[]> = {
  "shabbat 14": ["117+422+701+902", "104+401+701+904", "106+402+701+909", "119+409+701+910", "105+415+701+902", "111+417+701+912", "117+401+701+909", "117+402+701+904"],
  "shabbat 22": ["117+422+701", "104+401+701", "106+402+701", "119+417+701", "119+422+701", "117+417+701", "105+422+701", "111+409+701"],
  "holiday 14": ["117+422+701+902", "104+401+701+904", "106+402+701+909", "119+409+701+910", "105+415+701+902", "111+417+701+912", "117+401+701+909", "117+402+701+904"],
  "holiday 22": ["117+422+701", "104+401+701", "106+402+701", "119+417+701", "119+422+701", "117+417+701", "105+422+701", "111+409+701"],
  "date 14": ["104+302+704+902", "105+301+711+904", "108+405+704+904", "109+406+704+912", "111+413+711+902", "118+414+704+909", "104+405+711+912", "108+302+711+909"],
  "date 22": ["104+302+704", "108+405+711", "109+301+704", "105+406+704", "111+414+704", "118+418+704", "107+413+704", "110+419+704"],
  "interview 14": ["104+302+701+902", "117+401+704+904", "106+402+711+909", "105+301+701+904", "108+405+701+912", "109+403+701+909", "119+404+701+910", "107+409+701+901"],
  "interview 22": ["104+302+701", "106+401+704", "117+301+711", "108+405+701", "109+403+701", "119+406+701", "107+402+701", "106+301+701"],
  "weekday 14": ["107+201+704+901", "110+204+711+903", "114+303+705+905", "1004+116+407+713", "1005+105+408+706", "111+212+704+905", "118+420+704+903", "107+420+711+905"],
  "weekday 22": ["102+201+704", "103+204+711", "107+303+705", "110+408+712", "115+215+704", "114+302+708", "102+215+711", "115+201+711"],
};

describe("every other rule set is unchanged", () => {
  for (const [key, ids] of Object.entries(BEFORE)) {
    const [type, temp] = key.split(" ") as [keyof typeof DEFAULT_CONTEXT_RULES, string];
    it(key, () => expect(run(wardrobe, DEFAULT_CONTEXT_RULES[type], temp === "14" ? MILD : WARM).map((c) => c.outfit_id)).toEqual(ids));
  }
});
