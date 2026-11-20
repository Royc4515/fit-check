import type { Item, ItemTags, Subcategory } from "@fit-check/schema";
import { SAVED_OUTFIT_NAME_MAX, SUBCATEGORY_TO_CATEGORY } from "@fit-check/schema";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  assertSaveable,
  editPlan,
  findSameOutfit,
  garmentChanges,
  itemSetKey,
  normalizeOutfitName,
  outfitProblems,
  removalAction,
  SavedOutfitError,
  savedOutfitsFromRows,
  undoKeepsOutfit,
  type OutfitPiece,
} from "./savedOutfit";

afterEach(() => vi.restoreAllMocks());

function item(id: string, sub: Subcategory): Item {
  const tags: ItemTags = {
    category: SUBCATEGORY_TO_CATEGORY[sub],
    subcategory: sub,
    color_name: "white",
    color_hex: "#F4F1EA",
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
  return { id, name: id, brand: null, tags, status: "active", availability: "home", source: "photo", price: null, currency: null, purchased_at: null, cutout_path: null, notes: null };
}

const TOP = item("t1", "tshirt");
const BOTTOM = item("b1", "chinos");
const SHOES = item("s1", "sneakers");
const LAYER = item("l1", "overshirt");

const three: OutfitPiece[] = [
  { item_id: "t1", slot: "top" },
  { item_id: "b1", slot: "bottom" },
  { item_id: "s1", slot: "shoes" },
];

describe("outfitProblems", () => {
  it("accepts top, bottom and shoes, with or without one layer", () => {
    expect(outfitProblems(three)).toEqual([]);
    expect(outfitProblems([...three, { item_id: "l1", slot: "layer" }])).toEqual([]);
  });

  it("names every missing required slot, in reading order", () => {
    expect(outfitProblems([{ item_id: "b1", slot: "bottom" }])).toEqual([
      { kind: "missing", slot: "top" },
      { kind: "missing", slot: "shoes" },
    ]);
    expect(outfitProblems([])).toHaveLength(3);
  });

  it("rejects a second garment for a slot, a second layer included", () => {
    expect(outfitProblems([...three, { item_id: "t2", slot: "top" }])).toEqual([{ kind: "extra", slot: "top" }]);
    expect(outfitProblems([...three, { item_id: "l1", slot: "layer" }, { item_id: "l2", slot: "layer" }])).toEqual([{ kind: "extra", slot: "layer" }]);
  });

  it("rejects the same item twice, reported once", () => {
    const pieces: OutfitPiece[] = [...three, { item_id: "t1", slot: "layer" }, { item_id: "t1", slot: "layer" }];
    expect(outfitProblems(pieces)).toEqual([
      { kind: "extra", slot: "layer" },
      { kind: "duplicate_item", itemId: "t1" },
    ]);
  });

  it("assertSaveable throws a typed error carrying the problems", () => {
    expect(() => assertSaveable(three)).not.toThrow();
    try {
      assertSaveable(three.slice(0, 2));
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(SavedOutfitError);
      expect((e as SavedOutfitError).code).toBe("invalid_outfit");
      expect((e as SavedOutfitError).problems).toEqual([{ kind: "missing", slot: "shoes" }]);
    }
  });
});

describe("normalizeOutfitName", () => {
  it("trims, and turns an empty or blank name into null", () => {
    expect(normalizeOutfitName("  ליום שישי \n")).toBe("ליום שישי");
    expect(normalizeOutfitName("")).toBeNull();
    expect(normalizeOutfitName("   \t")).toBeNull();
    expect(normalizeOutfitName(null)).toBeNull();
    expect(normalizeOutfitName(undefined)).toBeNull();
  });

  it("allows exactly the maximum after trimming and rejects one more", () => {
    const max = "א".repeat(SAVED_OUTFIT_NAME_MAX);
    expect(normalizeOutfitName(`  ${max}  `)).toBe(max);
    expect(() => normalizeOutfitName(`${max}ב`)).toThrow(SavedOutfitError);
    try {
      normalizeOutfitName(`${max}ב`);
    } catch (e) {
      expect((e as SavedOutfitError).code).toBe("name_too_long");
    }
  });

  it("counts characters as the database does (code points), not UTF-16 units", () => {
    // 40 emoji are 80 UTF-16 units but 40 characters for char_length.
    expect(normalizeOutfitName("👔".repeat(SAVED_OUTFIT_NAME_MAX))).toBe("👔".repeat(SAVED_OUTFIT_NAME_MAX));
  });
});

describe("the same garments are the same outfit", () => {
  it("keys a set independently of order and repetition", () => {
    expect(itemSetKey(["c", "a", "b"])).toBe(itemSetKey(["b", "c", "a"]));
    expect(itemSetKey(["a", "a", "b"])).toBe(itemSetKey(["b", "a"]));
    expect(itemSetKey(["a", "b"])).not.toBe(itemSetKey(["a", "b", "c"]));
  });

  it("finds a saved outfit with exactly the same garments in any order, and nothing for a subset or superset", () => {
    const saved = [
      { id: "o1", itemIds: ["t1", "b1", "s1", "l1"] },
      { id: "o2", itemIds: ["s1", "t1", "b1"] },
    ];
    expect(findSameOutfit(saved, ["b1", "s1", "t1"])).toBe("o2");
    expect(findSameOutfit(saved, ["l1", "s1", "b1", "t1"])).toBe("o1");
    expect(findSameOutfit(saved, ["t1", "b1"])).toBeNull();
    expect(findSameOutfit(saved, ["t1", "b1", "s1", "x"])).toBeNull();
  });

  it("skips the outfit being saved itself", () => {
    expect(findSameOutfit([{ id: "o2", itemIds: ["t1", "b1", "s1"] }], ["t1", "b1", "s1"], "o2")).toBeNull();
  });
});

function row(over: Record<string, unknown> = {}) {
  return {
    id: "o1",
    name: null,
    is_favorite: false,
    saved_at: "2026-11-19T08:00:00+00:00",
    context_type: "weekday",
    source: "manual",
    created_for_date: "2026-11-19",
    outfit_items: [
      // Stored in any order; the model is in reading order.
      { item_id: "s1", slot: "shoes", item: SHOES },
      { item_id: "l1", slot: "layer", item: LAYER },
      { item_id: "t1", slot: "top", item: TOP },
      { item_id: "b1", slot: "bottom", item: BOTTOM },
    ],
    wears: [],
    ...over,
  };
}

describe("rows to saved outfits", () => {
  it("maps an outfit that was never worn", () => {
    const [o] = savedOutfitsFromRows([row({ name: "ליום שישי", is_favorite: true })]);
    expect(o).toMatchObject({
      id: "o1",
      name: "ליום שישי",
      isFavorite: true,
      savedAt: "2026-11-19T08:00:00+00:00",
      contextType: "weekday",
      source: "manual",
      createdForDate: "2026-11-19",
      missing: [],
      wornCount: 0,
      lastWornOn: null,
    });
    expect(o!.pieces.map((p) => [p.slot, p.item.id])).toEqual([
      ["top", "t1"],
      ["bottom", "b1"],
      ["shoes", "s1"],
      ["layer", "l1"],
    ]);
    expect(o!.itemIds).toEqual(["s1", "l1", "t1", "b1"]);
  });

  it("counts only worn wears and finds the latest date whatever the order", () => {
    const [o] = savedOutfitsFromRows([
      row({
        wears: [
          { worn_on: "2026-11-02", feedback: "worn" },
          { worn_on: "2026-11-15", feedback: "skipped" },
          { worn_on: "2026-11-12", feedback: "worn" },
          { worn_on: "2026-11-05", feedback: "worn" },
        ],
      }),
    ]);
    expect(o!.wornCount).toBe(3);
    expect(o!.lastWornOn).toBe("2026-11-12");
  });

  it("keeps an outfit whose garment was deleted, with the slot in `missing`", () => {
    const [o] = savedOutfitsFromRows([row({ outfit_items: [{ item_id: "t1", slot: "top", item: TOP }, { item_id: "s1", slot: "shoes", item: SHOES }] })]);
    expect(o!.missing).toEqual(["bottom"]);
    expect(o!.pieces.map((p) => p.slot)).toEqual(["top", "shoes"]);
  });

  it("treats an unreadable garment as missing instead of dropping the outfit", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const [o] = savedOutfitsFromRows([row({ outfit_items: [{ item_id: "t1", slot: "top", item: { id: "t1" } }, { item_id: "b1", slot: "bottom", item: BOTTOM }, { item_id: "s1", slot: "shoes", item: SHOES }] })]);
    expect(o!.missing).toEqual(["top"]);
    expect(o!.itemIds).toEqual(["t1", "b1", "s1"]);
  });

  it("keeps an outfit with no garments at all (a crash between the two inserts), every slot missing", () => {
    const [o] = savedOutfitsFromRows([row({ outfit_items: [] })]);
    expect(o!.missing).toEqual(["top", "bottom", "shoes"]);
  });

  it("orders newest saved first, ties by id, and skips unsaved and malformed rows", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const list = savedOutfitsFromRows([
      row({ id: "a", saved_at: "2026-11-10T10:00:00+00:00" }),
      row({ id: "c", saved_at: "2026-11-18T10:00:00+00:00" }),
      row({ id: "b", saved_at: "2026-11-18T12:00:00+02:00" }),
      row({ id: "x", saved_at: null }),
      { id: "broken" },
    ]);
    expect(list.map((o) => o.id)).toEqual(["b", "c", "a"]);
  });
});

describe("delete decisions", () => {
  it("removing keeps the row when it has any wear, deletes it when it has none", () => {
    expect(removalAction(0)).toBe("delete");
    expect(removalAction(1)).toBe("unsave");
    expect(removalAction(7)).toBe("unsave");
  });

  it("undo deletes only an unsaved outfit no other wear points at", () => {
    expect(undoKeepsOutfit({ savedAt: null, remainingWears: 0 })).toBe(false);
    expect(undoKeepsOutfit({ savedAt: "2026-11-19T08:00:00Z", remainingWears: 0 })).toBe(true);
    expect(undoKeepsOutfit({ savedAt: null, remainingWears: 2 })).toBe(true);
    expect(undoKeepsOutfit(null)).toBe(true);
  });
});

describe("garmentChanges", () => {
  const cur: OutfitPiece[] = [
    { item_id: "t1", slot: "top" },
    { item_id: "b1", slot: "bottom" },
    { item_id: "s1", slot: "shoes" },
    { item_id: "l1", slot: "layer" },
  ];

  it("adds what is new, removes what is gone, keeps the rest untouched", () => {
    const next: OutfitPiece[] = [
      { item_id: "t2", slot: "top" },
      { item_id: "b1", slot: "bottom" },
      { item_id: "s1", slot: "shoes" },
    ];
    expect(garmentChanges(cur, next)).toEqual({ add: [{ item_id: "t2", slot: "top" }], reslot: [], remove: ["t1", "l1"] });
  });

  it("is empty for the same garments in another order", () => {
    expect(garmentChanges(cur, [...cur].reverse())).toEqual({ add: [], reslot: [], remove: [] });
  });

  it("re-slots a kept garment whose slot changed, never deleting and inserting it (the key is the item)", () => {
    expect(garmentChanges(cur, [{ item_id: "l1", slot: "top" }, ...cur.slice(1, 3)])).toEqual({ add: [], reslot: [{ item_id: "l1", slot: "top" }], remove: ["t1"] });
  });
});

describe("editPlan: what was worn is never rewritten", () => {
  const AT = "2026-11-10T08:00:00.123456+00:00";
  const base = { id: "o1", savedAt: AT, currentItemIds: ["t1", "b1", "s1"], nextItemIds: ["t3", "b1", "s1"] };
  const self = { id: "o1", savedAt: AT, itemIds: ["t1", "b1", "s1"] };

  it("edits in place when never worn, or when only the name or context changes", () => {
    expect(editPlan({ ...base, wearCount: 0, saved: [self] })).toEqual({ kind: "in_place" });
    expect(editPlan({ ...base, wearCount: 3, nextItemIds: ["s1", "t1", "b1"], saved: [self] })).toEqual({ kind: "in_place" });
  });

  it("copies when worn (any feedback counts) and the garments change", () => {
    expect(editPlan({ ...base, wearCount: 1, saved: [self] })).toEqual({ kind: "copy" });
  });

  it("recognises a half-done copy by the same garments AND the exact saved_at, and resumes it", () => {
    const copy = { id: "n1", savedAt: AT, itemIds: ["s1", "b1", "t3"] };
    expect(editPlan({ ...base, wearCount: 1, saved: [self, copy] })).toEqual({ kind: "resume", copyId: "n1" });
  });

  it("refuses another saved outfit with the new garments: a different saved_at is not a copy", () => {
    const other = { id: "o2", savedAt: "2026-11-10T08:00:00.123457+00:00", itemIds: ["t3", "b1", "s1"] };
    expect(editPlan({ ...base, wearCount: 1, saved: [self, other] })).toEqual({ kind: "same_garments", otherId: "o2" });
    expect(editPlan({ ...base, wearCount: 0, saved: [self, other] })).toEqual({ kind: "same_garments", otherId: "o2" });
  });

  it("does not take a same-saved_at row for a copy when the edit is in place (never worn)", () => {
    const twin = { id: "n1", savedAt: AT, itemIds: ["t3", "b1", "s1"] };
    expect(editPlan({ ...base, wearCount: 0, saved: [self, twin] })).toEqual({ kind: "same_garments", otherId: "n1" });
  });
});
