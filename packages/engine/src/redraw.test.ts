import { describe, expect, it } from "vitest";
import { ItemSchema, MAX_REDRAW_DETAILS, RedrawSpecSchema, type Item, type ItemTags, type RedrawSpec } from "@fit-check/schema";
import wardrobeJson from "../__fixtures__/wardrobe.json";
import { detailsFromText, detailToFree, setFree, suggestRedraw, toggleDetail, toggleFix, withTags, type RedrawHistoryEntry } from "./redraw";

const wardrobe: Item[] = (wardrobeJson as unknown[]).map((row) => ItemSchema.parse(row));
const named = (name: string) => {
  const item = wardrobe.find((i) => i.name === name);
  if (!item) throw new Error(`fixture has no ${name}`);
  return item;
};

const shirtTags: ItemTags = named("Zara Mandarin Collar").tags;

function entry(itemId: string, patch: Partial<RedrawSpec>): RedrawHistoryEntry {
  const base = suggestRedraw({ tags: shirtTags, name: "x" }).spec;
  return { itemId, spec: RedrawSpecSchema.parse({ ...base, ...patch }) };
}

describe("suggestRedraw: preselection", () => {
  it("reads the cut from the name", () => {
    const s = suggestRedraw({ tags: shirtTags, name: "Zara Mandarin Collar" });
    expect(s.spec.details).toEqual(["collar_mandarin"]);
    expect(s.details[0]).toBe("collar_mandarin");
  });

  it("reads brand logos and oxford collars from real wardrobe names", () => {
    const tommy = named("Tommy Hilfiger Oxford");
    expect(suggestRedraw({ tags: tommy.tags, name: tommy.name }).spec.details).toEqual(["collar_button_down", "logo_chest"]);
    const chelsea = named("Timberland Chelsea Boots");
    expect(suggestRedraw({ tags: chelsea.tags, name: chelsea.name }).spec.details).toEqual(["slip_on"]);
  });

  it("takes detection's description and brand into account", () => {
    const s = suggestRedraw({ tags: shirtTags, name: "Shirt", brand: "Gant", description: "white shirt with two pocket flaps" });
    expect(s.spec.details).toEqual(["pocket_two", "logo_chest"]);
  });

  it("maps detection issues to fixes, in fix order", () => {
    const s = suggestRedraw({ tags: shirtTags, name: "Shirt", issues: ["wrinkled", "overlapping", "blurry"] });
    expect(s.spec.fixes).toEqual(["remove_behind", "smooth_creases", "sharp_texture"]);
  });

  it("starts from the item's previous spec instead of guessing again", () => {
    const previous = entry("item-1", { details: ["collar_spread"], fixes: ["true_colour"], free: [{ kind: "detail", text: "כיס עם דש" }] }).spec;
    const s = suggestRedraw({ tags: shirtTags, name: "Zara Mandarin Collar", previous, itemId: "item-1" });
    expect(s.spec.details).toEqual(["collar_spread"]);
    expect(s.spec.fixes).toEqual(["true_colour"]);
    expect(s.spec.free).toEqual([{ kind: "detail", text: "כיס עם דש" }]);
  });

  it("drops previous details the current garment type no longer takes", () => {
    const previous = entry("item-1", { details: ["collar_spread", "pocket_one"] }).spec;
    const jeans = named("Koton Jeans").tags;
    expect(suggestRedraw({ tags: jeans, name: "Koton Jeans", previous }).spec.details).toEqual([]);
  });

  it("always produces a valid spec", () => {
    for (const item of wardrobe) {
      const s = suggestRedraw({ tags: item.tags, name: item.name, brand: item.brand, description: item.notes, issues: ["occluded", "dark"] });
      expect(RedrawSpecSchema.safeParse(s.spec).success, item.name).toBe(true);
    }
  });
});

describe("suggestRedraw: ranking and free notes", () => {
  const history = [
    entry("a", { details: ["logo_chest"], free: [{ kind: "detail", text: "Contrast stitching" }] }),
    entry("b", { details: ["logo_chest", "cuffs_button"], free: [{ kind: "detail", text: "contrast  stitching" }] }),
    entry("c", { details: ["cuffs_button"], free: [{ kind: "fix", text: "once only" }] }),
  ];

  it("orders chips: selected, then most used for this garment type, then vocabulary", () => {
    const s = suggestRedraw({ tags: shirtTags, name: "Zara Mandarin Collar", history });
    expect(s.details.slice(0, 3)).toEqual(["collar_mandarin", "logo_chest", "cuffs_button"]);
  });

  it("offers back a note typed twice, case and spacing ignored, and not one typed once", () => {
    const s = suggestRedraw({ tags: shirtTags, name: "Shirt", history });
    expect(s.freeSuggestions).toEqual([{ kind: "detail", text: "Contrast stitching" }]);
  });

  it("ignores the item's own history and other garment types", () => {
    const s = suggestRedraw({ tags: shirtTags, name: "Shirt", history: history.slice(0, 2), itemId: "a" });
    expect(s.freeSuggestions).toEqual([]);
    const jeans = named("Koton Jeans").tags;
    expect(suggestRedraw({ tags: jeans, name: "Jeans", history }).freeSuggestions).toEqual([]);
  });

  it("does not offer a note already in the spec", () => {
    const previous = entry("z", { free: [{ kind: "detail", text: "contrast stitching" }] }).spec;
    expect(suggestRedraw({ tags: shirtTags, name: "Shirt", history, previous, itemId: "z" }).freeSuggestions).toEqual([]);
  });
});

describe("detailsFromText", () => {
  it("picks the longest keyword within a group", () => {
    const offered = suggestRedraw({ tags: shirtTags, name: "x" }).details;
    expect(detailsFromText("no pocket oxford", offered)).toEqual(["collar_button_down", "pocket_none"]);
  });
  it("matches Hebrew words", () => {
    const offered = suggestRedraw({ tags: shirtTags, name: "x" }).details;
    expect(detailsFromText("חולצה עם צווארון מנדרין וכיס", offered)).toEqual(["collar_mandarin", "pocket_one"]);
  });
});

describe("editing the spec", () => {
  const base = suggestRedraw({ tags: { ...shirtTags, subcategory: "overshirt", category: "layer" }, name: "Overshirt" }).spec;

  it("swaps within a group instead of stacking two collars", () => {
    const a = toggleDetail(base, "collar_mandarin");
    expect(toggleDetail(a, "collar_spread").details).toEqual(["collar_spread"]);
    expect(toggleDetail(toggleDetail(a, "collar_spread"), "collar_spread").details).toEqual([]);
  });

  it("ignores a seventh detail", () => {
    const trousers = suggestRedraw({ tags: named("Dress Trousers").tags, name: "Trousers" }).spec;
    let s: RedrawSpec = { ...trousers, details: [] };
    for (const id of ["belt_loops", "pleats", "crease", "drawstring", "turn_ups", "leg_tapered"] as const) s = toggleDetail(s, id);
    expect(s.details).toHaveLength(MAX_REDRAW_DETAILS);
    expect(toggleDetail(s, "cargo_pockets")).toBe(s);
    // A swap inside a full spec still works: it frees a place first.
    expect(toggleDetail(s, "leg_wide").details).toContain("leg_wide");
    expect(toggleDetail(s, "flat_front").details).toHaveLength(MAX_REDRAW_DETAILS);
  });

  it("keeps fixes in canonical order", () => {
    expect(toggleFix(toggleFix(base, "sharp_texture"), "remove_behind").fixes).toEqual(["remove_behind", "sharp_texture"]);
  });

  it("adds, edits, dedupes, caps and clears notes", () => {
    let s = setFree(base, { kind: "detail", text: ' כיס "עם" דש ' });
    expect(s.free).toEqual([{ kind: "detail", text: "כיס עם דש" }]);
    expect(setFree(s, { kind: "detail", text: "כיס עם דש" })).toBe(s);
    s = setFree(s, { kind: "fix", text: "בלי קמטים" });
    expect(setFree(s, { kind: "fix", text: "third" })).toBe(s);
    s = setFree(s, { kind: "fix", text: "בלי קמטים בכלל" }, 1);
    expect(s.free[1]).toEqual({ kind: "fix", text: "בלי קמטים בכלל" });
    expect(setFree(s, { kind: "fix", text: " " }, 1).free).toHaveLength(1);
    expect(RedrawSpecSchema.safeParse(s).success).toBe(true);
  });

  it("turns a detail into an editable note, but never loses it when there is no room", () => {
    const withLogo = toggleDetail(base, "logo_chest");
    const s = detailToFree(withLogo, "logo_chest", "לוגו רקום אדום");
    expect(s.details).toEqual([]);
    expect(s.free).toEqual([{ kind: "detail", text: "לוגו רקום אדום" }]);
    const full = setFree(setFree(withLogo, { kind: "detail", text: "aa" }), { kind: "detail", text: "bb" });
    expect(detailToFree(full, "logo_chest", "x y")).toBe(full);
  });

  it("follows tag edits and drops details the new type cannot take", () => {
    const s = toggleDetail(toggleDetail(base, "hood"), "logo_chest");
    const jeans = named("Koton Jeans").tags;
    const next = withTags(s, jeans, "  ");
    expect(next.garment.subcategory).toBe("jeans");
    expect(next.details).toEqual([]);
    expect(next.name).toBeNull();
  });
});
