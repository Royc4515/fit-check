import type { Availability, Item, ItemTags, Subcategory } from "@fit-check/schema";
import { SUBCATEGORY_TO_CATEGORY } from "@fit-check/schema";
import { describe, expect, it } from "vitest";
import {
  draftFromOutfit,
  draftPieces,
  editKeepsWornCopy,
  emptyDraft,
  isDirty,
  missingKey,
  missingSlots,
  nameLength,
  pickerItems,
  withPiece,
  type Draft,
} from "./builder";

function item(id: string, sub: Subcategory, over: Partial<ItemTags> & { name?: string; brand?: string | null; status?: Item["status"]; availability?: Availability } = {}): Item {
  const { name, brand, status, availability, ...tagOver } = over;
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
    formality: 4,
    temp_min_c: 10,
    temp_max_c: 35,
    modesty_flags: [],
    style_tags: [],
    ...tagOver,
  };
  return {
    id,
    name: name ?? id,
    brand: brand ?? null,
    tags,
    status: status ?? "active",
    availability: availability ?? "home",
    source: "photo",
    price: null,
    currency: null,
    purchased_at: null,
    cutout_path: null,
    notes: null,
  };
}

const polo = item("t1", "polo", { name: "Benetton Polo", brand: "Benetton" });
const chinos = item("b1", "chinos", { name: "צ'ינו בז'", color_name: "beige", color_hex: "#C8B48A" });
const sneakers = item("s1", "sneakers", { name: "Veja", formality: 3 });

describe("missing line", () => {
  it("names exactly what is missing, one key per combination", () => {
    const d = (pieces: Draft["pieces"]): Draft => ({ ...emptyDraft(), pieces });
    expect(missingKey(missingSlots(d({})))).toBe("all");
    expect(missingKey(missingSlots(d({ top: polo })))).toBe("bottom_shoes");
    expect(missingKey(missingSlots(d({ bottom: chinos })))).toBe("top_shoes");
    expect(missingKey(missingSlots(d({ shoes: sneakers })))).toBe("top_bottom");
    expect(missingKey(missingSlots(d({ top: polo, bottom: chinos })))).toBe("shoes");
    expect(missingKey(missingSlots(d({ top: polo, shoes: sneakers })))).toBe("bottom");
    expect(missingKey(missingSlots(d({ bottom: chinos, shoes: sneakers })))).toBe("top");
    expect(missingKey(missingSlots(d({ top: polo, bottom: chinos, shoes: sneakers })))).toBeNull();
  });

  it("does not count the layer: it is optional", () => {
    expect(missingSlots({ ...emptyDraft(), pieces: { top: polo, bottom: chinos, shoes: sneakers } })).toEqual([]);
  });
});

describe("draft", () => {
  it("opens an edit with the outfit's garments, context and name; a deleted garment's slot is empty", () => {
    const draft = draftFromOutfit({ pieces: [{ slot: "top", item: polo }, { slot: "shoes", item: sneakers }], contextType: "shabbat", name: "שבת" });
    expect(draftPieces(draft)).toEqual([
      { item_id: "t1", slot: "top" },
      { item_id: "s1", slot: "shoes" },
    ]);
    expect(draft).toMatchObject({ contextType: "shabbat", name: "שבת" });
    expect(missingSlots(draft)).toEqual(["bottom"]);
  });

  it("is dirty only when a garment, the context or the trimmed name changed", () => {
    const start = emptyDraft();
    expect(isDirty(start, start)).toBe(false);
    expect(isDirty({ ...start, name: "   " }, start)).toBe(false);
    expect(isDirty({ ...start, name: "ערב" }, start)).toBe(true);
    expect(isDirty({ ...start, contextType: "date" }, start)).toBe(true);
    const chosen = withPiece(start, "top", polo);
    expect(isDirty(chosen, start)).toBe(true);
    expect(isDirty(withPiece(chosen, "top", null), start)).toBe(false);
  });

  it("counts a name in code points", () => {
    expect(nameLength("👔".repeat(40))).toBe(40);
  });
});

describe("pickerItems", () => {
  const wardrobe = [
    item("t-b", "tshirt", { name: "Basic tee", color_name: "white", color_hex: "#FFFFFF" }),
    item("t-a", "polo", { name: "Alpha polo", color_name: "green", color_hex: "#40C040", formality: 4 }),
    item("t-arch", "polo", { name: "Archived polo", status: "archived" }),
    item("t-away", "button_down", { name: "Away shirt", availability: "laundry", color_name: "white", color_hex: "#FFFFFF", formality: 6 }),
    item("t-c", "polo", { name: "Charlie polo", brand: "ZARA", formality: 9 }),
    chinos,
    sneakers,
    item("o1", "coat", { name: "Coat" }),
  ];

  it("offers every listed garment of the slot, archived excluded, not-at-home included, in the wardrobe's order", () => {
    expect(pickerItems(wardrobe, "top", "", emptyDraft(), new Map()).map((i) => i.id)).toEqual(["t-a", "t-away", "t-b", "t-c"]);
    expect(pickerItems(wardrobe, "layer", "", emptyDraft(), new Map())).toEqual([]);
  });

  it("searches name and brand in any case", () => {
    expect(pickerItems(wardrobe, "top", "zara", emptyDraft(), new Map()).map((i) => i.id)).toEqual(["t-c"]);
    expect(pickerItems(wardrobe, "bottom", "צ'ינו", emptyDraft(), new Map()).map((i) => i.id)).toEqual(["b1"]);
    expect(pickerItems(wardrobe, "top", "nothing", emptyDraft(), new Map())).toEqual([]);
  });

  it("orders by compatibility with the other chosen slots once one is chosen, never with the slot's own garment", () => {
    // Orange trousers: green (90 degrees) clashes, white and navy are neutral; the formal 9 sits far from 4 and 3.
    const orange = item("b-o", "chinos", { color_name: "orange", color_hex: "#E07020" });
    const draft = withPiece(withPiece(emptyDraft(), "bottom", orange), "shoes", sneakers);
    const order = pickerItems(wardrobe, "top", "", draft, new Map()).map((i) => i.id);
    expect(order.indexOf("t-a")).toBeGreaterThan(order.indexOf("t-b"));
    expect(order[order.length - 1]).toBe("t-c");
    // Choosing a top does not reorder the tops themselves.
    const withTop = withPiece(emptyDraft(), "top", polo);
    expect(pickerItems(wardrobe, "top", "", withTop, new Map()).map((i) => i.id)).toEqual(["t-a", "t-away", "t-b", "t-c"]);
    // Deterministic.
    expect(pickerItems(wardrobe, "top", "", draft, new Map()).map((i) => i.id)).toEqual(order);
  });
});

describe("editKeepsWornCopy", () => {
  const initial = withPiece(withPiece(withPiece(emptyDraft(), "top", polo), "bottom", chinos), "shoes", sneakers);
  const other = item("t9", "polo");
  it("is true only when editing a worn outfit whose garments now differ", () => {
    expect(editKeepsWornCopy(true, 1, withPiece(initial, "top", other), initial)).toBe(true);
    expect(editKeepsWornCopy(true, 0, withPiece(initial, "top", other), initial)).toBe(false);
    expect(editKeepsWornCopy(false, 1, withPiece(initial, "top", other), initial)).toBe(false);
    expect(editKeepsWornCopy(true, 1, { ...initial, name: "חדש", contextType: "date" }, initial)).toBe(false);
    // Changed and changed back: nothing differs any more.
    expect(editKeepsWornCopy(true, 1, withPiece(withPiece(initial, "top", other), "top", polo), initial)).toBe(false);
  });
});
