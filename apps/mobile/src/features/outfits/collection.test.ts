import type { Availability, Item, ItemTags, Subcategory } from "@fit-check/schema";
import { SUBCATEGORY_TO_CATEGORY } from "@fit-check/schema";
import { describe, expect, it } from "vitest";
import type { SavedOutfit } from "../../data/savedOutfit";
import {
  awayGarments,
  legendEntries,
  outfitCaption,
  outfitGridColumns,
  outfitTileWidth,
  visibleOutfits,
  withFavorite,
  withName,
  withOutfit,
  withWornChange,
  withoutOutfit,
  wornMeta,
} from "./collection";

function item(id: string, sub: Subcategory, availability: Availability = "home"): Item {
  const tags: ItemTags = {
    category: SUBCATEGORY_TO_CATEGORY[sub],
    subcategory: sub,
    color_name: "navy",
    color_hex: "#1F2A44",
    secondary_color_hex: null,
    pattern: "solid",
    material: "cotton",
    sleeve: "short",
    fit: "regular",
    seasons: ["summer"],
    formality: 3,
    temp_min_c: 10,
    temp_max_c: 35,
    modesty_flags: [],
    style_tags: [],
  };
  return { id, name: id, brand: null, tags, status: "active", availability, source: "photo", price: null, currency: null, purchased_at: null, cutout_path: null, notes: null };
}

const TOP = item("t1", "polo");
const BOTTOM = item("b1", "chinos");
const SHOES = item("s1", "sneakers");
const LAYER = item("l1", "overshirt", "laundry");

function outfit(id: string, over: Partial<SavedOutfit> = {}): SavedOutfit {
  return {
    id,
    name: null,
    isFavorite: false,
    savedAt: "2026-11-10T10:00:00.000Z",
    contextType: "weekday",
    source: "manual",
    createdForDate: "2026-11-10",
    pieces: [
      { slot: "top", item: TOP },
      { slot: "bottom", item: BOTTOM },
      { slot: "shoes", item: SHOES },
    ],
    missing: [],
    itemIds: ["t1", "b1", "s1"],
    wornCount: 0,
    lastWornOn: null,
    ...over,
  };
}

const TYPES: Record<string, string> = { polo: "פולו", chinos: "צ'ינו", sneakers: "סניקרס", overshirt: "אוברשירט" };
const typeOf = (s: string) => TYPES[s] ?? s;

describe("visibleOutfits: the two tabs", () => {
  const list = [outfit("a"), outfit("b", { isFavorite: true }), outfit("c")];
  it("all keeps every outfit in the collection's order", () => {
    expect(visibleOutfits(list, "all").map((o) => o.id)).toEqual(["a", "b", "c"]);
  });
  it("favourites keeps only the favourites, in the same order", () => {
    expect(visibleOutfits(list, "favorites").map((o) => o.id)).toEqual(["b"]);
    expect(visibleOutfits([outfit("a")], "favorites")).toEqual([]);
  });
});

describe("outfitGridColumns: 2 up to 599, 3 up to 899, 4 above", () => {
  it.each([
    [360, 2],
    [599, 2],
    [600, 3],
    [899, 3],
    [900, 4],
    [1600, 4],
  ])("%i px → %i", (w, n) => expect(outfitGridColumns(w)).toBe(n));
  it("tiles fill the row with the 8 gap and never round past it", () => {
    expect(outfitTileWidth(358, 2, 8)).toBe(175);
    const w = outfitTileWidth(1168, 4, 8);
    expect(w * 4 + 8 * 3).toBeLessThanOrEqual(1168);
  });
});

describe("outfitCaption", () => {
  it("is the name when there is one", () => {
    expect(outfitCaption(outfit("a", { name: "שבת חורף" }), typeOf)).toEqual({ text: "שבת חורף", named: true });
  });
  it("without a name, lists the garment types in reading order with ' · '", () => {
    expect(outfitCaption(outfit("a"), typeOf)).toEqual({ text: "פולו · צ'ינו · סניקרס", named: false });
  });
  it("leaves out a deleted garment", () => {
    const o = outfit("a", { pieces: [{ slot: "top", item: TOP }, { slot: "bottom", item: BOTTOM }], missing: ["shoes"] });
    expect(outfitCaption(o, typeOf).text).toBe("פולו · צ'ינו");
  });
});

describe("wornMeta", () => {
  it("never worn", () => {
    expect(wornMeta(outfit("a"))).toEqual({ kind: "never" });
  });
  it("count and the last date", () => {
    expect(wornMeta(outfit("a", { wornCount: 3, lastWornOn: "2026-11-12" }))).toEqual({ kind: "worn", count: 3, last: "2026-11-12" });
  });
  it("a count without a date reads as never worn, not a blank", () => {
    expect(wornMeta(outfit("a", { wornCount: 2, lastWornOn: null }))).toEqual({ kind: "never" });
  });
});

describe("legendEntries", () => {
  it("numbers the garments in reading order, layer last", () => {
    const o = outfit("a", { pieces: [...outfit("a").pieces, { slot: "layer", item: LAYER }] });
    expect(legendEntries(o).map((e) => [e.index, e.slot, e.item?.id])).toEqual([
      ["01", "top", "t1"],
      ["02", "bottom", "b1"],
      ["03", "shoes", "s1"],
      ["04", "layer", "l1"],
    ]);
  });
  it("keeps a deleted garment's place and number, with no item", () => {
    const o = outfit("a", { pieces: [{ slot: "top", item: TOP }, { slot: "shoes", item: SHOES }], missing: ["bottom"] });
    expect(legendEntries(o).map((e) => [e.index, e.slot, e.item?.id ?? null])).toEqual([
      ["01", "top", "t1"],
      ["02", "bottom", null],
      ["03", "shoes", "s1"],
    ]);
  });
  it("shows the wardrobe's current copy of a garment when given one", () => {
    const fresh = { ...TOP, availability: "laundry" as const };
    expect(legendEntries(outfit("a"), (i) => (i.id === "t1" ? fresh : i))[0]?.item?.availability).toBe("laundry");
  });
});

describe("awayGarments", () => {
  it("lists only garments that are not at home, skipping a deleted one", () => {
    const o = outfit("a", { pieces: [{ slot: "top", item: TOP }, { slot: "layer", item: LAYER }], missing: ["bottom", "shoes"] });
    expect(awayGarments(legendEntries(o)).map((i) => i.id)).toEqual(["l1"]);
    expect(awayGarments(legendEntries(outfit("a")))).toEqual([]);
  });
});

describe("list updates", () => {
  const list = [outfit("a"), outfit("b")];
  it("favourite, rename and remove touch only the one outfit", () => {
    expect(withFavorite(list, "b", true).map((o) => o.isFavorite)).toEqual([false, true]);
    expect(withName(list, "a", "x").map((o) => o.name)).toEqual(["x", null]);
    expect(withoutOutfit(list, "a").map((o) => o.id)).toEqual(["b"]);
  });
  it("withOutfit inserts or replaces by id and keeps newest saved first", () => {
    const newer = outfit("c", { savedAt: "2026-11-15T10:00:00.000Z" });
    expect(withOutfit(list, newer).map((o) => o.id)).toEqual(["c", "a", "b"]);
    expect(withOutfit(list, outfit("a", { name: "n" })).find((o) => o.id === "a")?.name).toBe("n");
    expect(withOutfit(list, outfit("a")).length).toBe(2);
  });
  it("withWornChange counts a wear and its undo, keeps the newest date, never goes below zero", () => {
    const one = withWornChange(list, "a", 1, "2026-11-19");
    const a = one.find((o) => o.id === "a")!;
    expect(a.wornCount).toBe(list.find((o) => o.id === "a")!.wornCount + 1);
    expect(a.lastWornOn! >= "2026-11-19").toBe(true);
    const fresh = [outfit("z", { wornCount: 0, lastWornOn: null })];
    const worn = withWornChange(fresh, "z", 1, "2026-11-20");
    expect(worn[0]).toMatchObject({ wornCount: 1, lastWornOn: "2026-11-20" });
    expect(withWornChange(worn, "z", -1, "2026-11-20")[0]).toMatchObject({ wornCount: 0, lastWornOn: null });
    expect(withWornChange(fresh, "z", -1, "2026-11-20")[0]).toMatchObject({ wornCount: 0, lastWornOn: null });
    expect(withWornChange(fresh, "nope", 1, "2026-11-20")).toEqual(fresh);
  });
});
