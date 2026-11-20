import { describe, expect, it } from "vitest";
import type { OutfitPiece } from "../../data/savedOutfit";
import { bookmarkOfKey, bookmarksDisabled, wearBookmark, wearFailureLine, wearShownSaved, type WornRow } from "./wearBookmark";

const TOP: OutfitPiece = { item_id: "t1", slot: "top" };
const BOTTOM: OutfitPiece = { item_id: "b1", slot: "bottom" };
const SHOES: OutfitPiece = { item_id: "s1", slot: "shoes" };
const row = (outfitId: string, pieces: OutfitPiece[] = [TOP, BOTTOM, SHOES]): WornRow => ({
  outfitId,
  itemIds: pieces.map((p) => p.item_id),
  savePieces: pieces,
});
const KEY = "b1,s1,t1";

describe("wearBookmark", () => {
  it("a worn row that is not saved marks its own outfit row", () => {
    expect(wearBookmark(row("o1"), [])).toEqual({ kind: "unsaved", key: KEY, write: { op: "mark", outfitId: "o1" } });
  });

  it("is saved when a saved outfit has the same garments, in any order, even when it is another row", () => {
    const saved = [{ id: "other-row", itemIds: ["s1", "t1", "b1"] }];
    expect(wearBookmark(row("o1"), saved)).toEqual({ kind: "saved", key: KEY, savedId: "other-row" });
  });

  it("two rows with one set are in the same state and share the key", () => {
    const saved = [{ id: "o2", itemIds: ["t1", "b1", "s1"] }];
    expect(wearBookmark(row("o1"), saved)).toEqual(wearBookmark(row("o2"), saved));
  });

  it("a set that differs by one garment is not saved", () => {
    const saved = [{ id: "o9", itemIds: ["t1", "b1", "s2"] }];
    expect(wearBookmark(row("o1"), saved).kind).toBe("unsaved");
  });

  it("an outfit that lost a garment cannot be saved", () => {
    expect(wearBookmark(row("o1", [TOP, BOTTOM]), [])).toEqual({ kind: "unsaveable", key: "b1,t1" });
  });

  it("a set in the collection shows as saved even if this row's own list is short", () => {
    const damaged: WornRow = { outfitId: "o1", itemIds: ["t1", "b1", "s1"], savePieces: [TOP, BOTTOM] };
    expect(wearBookmark(damaged, [{ id: "s", itemIds: ["t1", "b1", "s1"] }]).kind).toBe("saved");
  });
});

describe("wearShownSaved", () => {
  const unsaved = wearBookmark(row("o1"), []);
  const saved = wearBookmark(row("o1"), [{ id: "s", itemIds: ["t1", "b1", "s1"] }]);

  it("follows the store without a pending state", () => {
    expect(wearShownSaved(unsaved, null)).toBe(false);
    expect(wearShownSaved(saved, null)).toBe(true);
  });

  it("a pending state of the same set wins, on every row of the set", () => {
    expect(wearShownSaved(unsaved, { key: KEY, saved: true })).toBe(true);
    expect(wearShownSaved(saved, { key: KEY, saved: false })).toBe(false);
  });

  it("a pending state of another set does not touch this row", () => {
    expect(wearShownSaved(unsaved, { key: "other", saved: true })).toBe(false);
  });

  it("an unsaveable row is never filled", () => {
    expect(wearShownSaved({ kind: "unsaveable", key: "b1,t1" }, { key: "b1,t1", saved: true })).toBe(false);
  });
});

describe("wearFailureLine", () => {
  const failed = (over: Partial<{ key: string; wantSaved: boolean; unsaveable: boolean }> = {}) => ({ key: KEY, date: "2026-11-18", wantSaved: true, unsaveable: false, ...over });
  const unsaved = wearBookmark(row("o1"), []);
  const saved = wearBookmark(row("o1"), [{ id: "s", itemIds: ["t1", "b1", "s1"] }]);

  it("a failed save still not saved offers a retry of the current press", () => {
    expect(wearFailureLine(failed(), unsaved)).toEqual({ kind: "retry", wantSaved: true, intent: unsaved });
  });

  it("a failed removal of a set that is still saved offers a retry that removes the CURRENT saved outfit", () => {
    const now = wearBookmark(row("o1"), [{ id: "newer-id", itemIds: ["t1", "b1", "s1"] }]);
    expect(wearFailureLine(failed({ wantSaved: false }), now)).toEqual({ kind: "retry", wantSaved: false, intent: { kind: "saved", key: KEY, savedId: "newer-id" } });
  });

  it("no line once the state is what the user asked for (saved elsewhere meanwhile, or removed)", () => {
    expect(wearFailureLine(failed({ wantSaved: true }), saved)).toEqual({ kind: "none" });
    expect(wearFailureLine(failed({ wantSaved: false }), unsaved)).toEqual({ kind: "none" });
  });

  it("no line when no listed row has the set any more", () => {
    expect(wearFailureLine(failed(), null)).toEqual({ kind: "none" });
  });

  it("says the outfit cannot be saved, with no retry, for invalid_outfit and for a row the read already shows short", () => {
    expect(wearFailureLine(failed({ unsaveable: true }), unsaved)).toEqual({ kind: "cannotSave" });
    expect(wearFailureLine(failed(), { kind: "unsaveable", key: KEY })).toEqual({ kind: "cannotSave" });
  });
});

describe("bookmarkOfKey", () => {
  it("finds the row's bookmark by garment set, null when none is listed", () => {
    const rows = [row("o1", [TOP, BOTTOM]), row("o2")];
    expect(bookmarkOfKey(rows, [], KEY)).toEqual({ kind: "unsaved", key: KEY, write: { op: "mark", outfitId: "o2" } });
    expect(bookmarkOfKey(rows, [], "nope")).toBeNull();
  });

  it("prefers the pressed row while it is listed and unsaved, else the first row of the set", () => {
    const rows = [row("o1"), row("o2"), row("o3")];
    expect(bookmarkOfKey(rows, [], KEY, "o3")).toEqual({ kind: "unsaved", key: KEY, write: { op: "mark", outfitId: "o3" } });
    expect(bookmarkOfKey(rows, [], KEY, "gone")).toEqual({ kind: "unsaved", key: KEY, write: { op: "mark", outfitId: "o1" } });
    // Saved meanwhile: the set's state is saved on every row, so the preferred row no longer applies.
    expect(bookmarkOfKey(rows, [{ id: "s", itemIds: ["t1", "b1", "s1"] }], KEY, "o3")?.kind).toBe("saved");
  });
});

describe("bookmarksDisabled", () => {
  it("is inert until the saved list is read and while any write is on its way", () => {
    expect(bookmarksDisabled(false, null)).toBe(true);
    expect(bookmarksDisabled(true, null)).toBe(false);
    expect(bookmarksDisabled(true, { key: "other-set", saved: true })).toBe(true);
  });
});
