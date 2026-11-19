import { describe, expect, it } from "vitest";
import type { OutfitPiece } from "../../data/savedOutfit";
import { bookmarkIntent, shownSaved, wearOutfitId, type SavedLookup } from "./bookmark";

const TOP: OutfitPiece = { item_id: "t1", slot: "top" };
const BOTTOM: OutfitPiece = { item_id: "b1", slot: "bottom" };
const SHOES: OutfitPiece = { item_id: "s1", slot: "shoes" };
const LAYER: OutfitPiece = { item_id: "l1", slot: "layer" };
const base = { date: "2026-11-20", contextType: "shabbat" as const, source: "daily" as const, wornOutfitId: null };

describe("bookmarkIntent", () => {
  it("a suggestion that is not saved saves with the tab's date, context and source, in the shown order", () => {
    const intent = bookmarkIntent({ ...base, pieces: [TOP, BOTTOM, SHOES], saved: [] });
    expect(intent).toEqual({
      kind: "unsaved",
      key: "b1,s1,t1",
      write: { op: "save", date: "2026-11-20", contextType: "shabbat", source: "daily", pieces: [TOP, BOTTOM, SHOES] },
    });
  });

  it("a swapped suggestion saves with source swap", () => {
    const intent = bookmarkIntent({ ...base, source: "swap", pieces: [TOP, BOTTOM, SHOES], saved: [] });
    expect(intent.kind === "unsaved" && intent.write.op === "save" && intent.write.source).toBe("swap");
  });

  it("a worn outfit whose row is not saved marks that same row, and writes no new one", () => {
    const intent = bookmarkIntent({ ...base, pieces: [TOP, BOTTOM, SHOES], saved: [], wornOutfitId: "row-7" });
    expect(intent).toEqual({ kind: "unsaved", key: "b1,s1,t1", write: { op: "mark", outfitId: "row-7" } });
  });

  it("a shown set equal to a saved outfit's, in another order, is saved and removes that outfit", () => {
    const saved: SavedLookup = [{ id: "A", itemIds: ["s1", "t1", "b1"] }];
    expect(bookmarkIntent({ ...base, pieces: [TOP, BOTTOM, SHOES], saved })).toEqual({ kind: "saved", key: "b1,s1,t1", savedId: "A" });
  });

  it("a worn outfit whose set is saved is saved, not marked again", () => {
    const saved: SavedLookup = [{ id: "A", itemIds: ["t1", "b1", "s1"] }];
    expect(bookmarkIntent({ ...base, pieces: [TOP, BOTTOM, SHOES], saved, wornOutfitId: "row-7" }).kind).toBe("saved");
  });

  it("a swap changes the set: the same outfit with one garment replaced is not saved", () => {
    const saved: SavedLookup = [{ id: "A", itemIds: ["t1", "b1", "s1"] }];
    const swapped: OutfitPiece = { item_id: "b2", slot: "bottom" };
    expect(bookmarkIntent({ ...base, pieces: [TOP, swapped, SHOES], saved }).kind).toBe("unsaved");
  });

  it("a layer is part of the set: three pieces and four pieces are different outfits", () => {
    const saved: SavedLookup = [{ id: "A", itemIds: ["t1", "b1", "s1"] }];
    expect(bookmarkIntent({ ...base, pieces: [TOP, BOTTOM, SHOES, LAYER], saved }).kind).toBe("unsaved");
    expect(bookmarkIntent({ ...base, pieces: [TOP, BOTTOM, SHOES, LAYER], saved: [{ id: "B", itemIds: ["l1", "s1", "b1", "t1"] }] }).kind).toBe("saved");
  });

  it("is hidden when the outfit cannot be saved: no shoes (Yom Kippur), no pieces, two layers, an item twice", () => {
    expect(bookmarkIntent({ ...base, pieces: [TOP, BOTTOM], saved: [] }).kind).toBe("hidden");
    expect(bookmarkIntent({ ...base, pieces: [], saved: [] }).kind).toBe("hidden");
    expect(bookmarkIntent({ ...base, pieces: [TOP, BOTTOM, SHOES, LAYER, { item_id: "l2", slot: "layer" }], saved: [] }).kind).toBe("hidden");
    expect(bookmarkIntent({ ...base, pieces: [TOP, BOTTOM, SHOES, { item_id: "t1", slot: "layer" }], saved: [] }).kind).toBe("hidden");
  });

  it("is hidden even when a saved outfit has the same (incomplete) set", () => {
    const saved: SavedLookup = [{ id: "A", itemIds: ["t1", "b1"] }];
    expect(bookmarkIntent({ ...base, pieces: [TOP, BOTTOM], saved }).kind).toBe("hidden");
  });
});

describe("wearOutfitId", () => {
  const saved: SavedLookup = [
    { id: "A", itemIds: ["t1", "b1", "s1"] },
    { id: "B", itemIds: ["t2", "b1", "s1"] },
  ];

  it("a wear of a saved outfit points at its row, whatever the order of the garments", () => {
    expect(wearOutfitId(["s1", "b1", "t1"], saved)).toBe("A");
    expect(wearOutfitId(["t2", "s1", "b1"], saved)).toBe("B");
  });

  it("a set that is not saved gets no id: the wear writes its own unsaved row, as before saved outfits", () => {
    expect(wearOutfitId(["t3", "b1", "s1"], saved)).toBeUndefined();
    expect(wearOutfitId(["t1", "b1"], saved)).toBeUndefined();
  });

  it("before the saved outfits are read (an empty lookup) nothing is saved yet", () => {
    expect(wearOutfitId(["t1", "b1", "s1"], [])).toBeUndefined();
  });
});

describe("shownSaved", () => {
  const saved = { kind: "saved", key: "k", savedId: "A" } as const;
  const unsaved = { kind: "unsaved", key: "k", write: { op: "mark", outfitId: "r" } } as const;

  it("follows the store when nothing is pending", () => {
    expect(shownSaved(saved, null)).toBe(true);
    expect(shownSaved(unsaved, null)).toBe(false);
  });

  it("an optimistic state wins for its own garment set", () => {
    expect(shownSaved(unsaved, { key: "k", saved: true })).toBe(true);
    expect(shownSaved(saved, { key: "k", saved: false })).toBe(false);
  });

  it("an optimistic state of another set (the user swapped meanwhile) is ignored", () => {
    expect(shownSaved(unsaved, { key: "other", saved: true })).toBe(false);
  });

  it("is never saved when hidden", () => {
    expect(shownSaved({ kind: "hidden" }, { key: "k", saved: true })).toBe(false);
  });
});
