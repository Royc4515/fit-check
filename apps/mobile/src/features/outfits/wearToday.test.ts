import { ItemSchema, type Item } from "@fit-check/schema";
import { describe, expect, it } from "vitest";
import wardrobeJson from "../../../../../packages/engine/__fixtures__/wardrobe.json";
import type { TodayRecord } from "../../data/feedback";
import { wearPress, wearTodayState } from "./wearToday";

const fixture: Item[] = (wardrobeJson as unknown[]).map((row) => ItemSchema.parse(row));
const g = (id: string, status: Item["status"] = "active"): Item => ({ ...fixture[0]!, id, status });
const outfit = { itemIds: ["top", "bottom", "shoes"], missing: [] };
const garments = [g("top"), g("bottom"), g("shoes")];
const rec = (wearId: string, itemIds: string[], feedback: TodayRecord["feedback"] = "worn"): TodayRecord => ({
  wearId,
  outfitId: `o-${wearId}`,
  feedback,
  itemIds,
  date: "2026-11-20",
});

describe("wearTodayState", () => {
  it("offers the wear on a day with nothing worn, and waits while the day is not read", () => {
    expect(wearTodayState({ outfit, garments, today: [] })).toEqual({ kind: "fresh" });
    expect(wearTodayState({ outfit, garments, today: null })).toEqual({ kind: "loading" });
    // A skip is not a wear: the day is still free.
    expect(wearTodayState({ outfit, garments, today: [rec("s", ["a", "b", "c"], "skipped")] })).toEqual({ kind: "fresh" });
  });

  it("is worn when today's wear is these garments, in any order and on any row", () => {
    const worn = rec("w", ["shoes", "top", "bottom"]);
    expect(wearTodayState({ outfit, garments, today: [worn] })).toEqual({ kind: "worn", record: worn });
  });

  it("asks to replace when today's wear is another outfit; the newest wear is the day's", () => {
    const other = rec("x", ["a", "b", "c"]);
    expect(wearTodayState({ outfit, garments, today: [other] })).toEqual({ kind: "replace", earlier: other });
    // A correction whose delete failed leaves two: the newer one (this outfit) is the day's.
    expect(wearTodayState({ outfit, garments, today: [other, rec("w", ["top", "bottom", "shoes"])] }).kind).toBe("worn");
  });

  it("cannot be worn with a deleted or archived garment, but a wear already made keeps its line", () => {
    expect(wearTodayState({ outfit: { ...outfit, missing: ["shoes"] }, garments: garments.slice(0, 2), today: [] })).toEqual({ kind: "blocked", reason: "missing" });
    const archived = [g("top"), g("bottom", "archived"), g("shoes")];
    expect(wearTodayState({ outfit, garments: archived, today: [] })).toEqual({ kind: "blocked", reason: "archived", items: [archived[1]] });
    // Blocked before the day is read too: no bar either way.
    expect(wearTodayState({ outfit, garments: archived, today: null }).kind).toBe("blocked");
    const worn = rec("w", ["top", "bottom", "shoes"]);
    expect(wearTodayState({ outfit, garments: archived, today: [worn] })).toEqual({ kind: "worn", record: worn });
  });
});

describe("wearPress", () => {
  const other = rec("x", ["a", "b", "c"]);
  it("wears a free day and asks before replacing another wear", () => {
    expect(wearPress({ kind: "fresh" }, null)).toEqual({ kind: "wear" });
    expect(wearPress({ kind: "replace", earlier: other }, null)).toEqual({ kind: "confirm", earlier: other });
  });

  it("retries a confirmed replacement of the same wear without asking again, and asks for a different one", () => {
    expect(wearPress({ kind: "replace", earlier: other }, "x")).toEqual({ kind: "replace", earlier: other });
    expect(wearPress({ kind: "replace", earlier: other }, "older")).toEqual({ kind: "confirm", earlier: other });
  });

  it("recomputes a retry from the state now: a day that became free wears, one already worn does nothing", () => {
    // The replacement failed, then the earlier wear was undone on Today: try again is a plain wear.
    expect(wearPress({ kind: "fresh" }, "x")).toEqual({ kind: "wear" });
    expect(wearPress({ kind: "worn", record: rec("w", ["top"]) }, "x")).toEqual({ kind: "none" });
    expect(wearPress({ kind: "loading" }, null)).toEqual({ kind: "none" });
    expect(wearPress({ kind: "blocked", reason: "missing" }, null)).toEqual({ kind: "none" });
  });
});
