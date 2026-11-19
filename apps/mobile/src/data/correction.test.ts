import { describe, expect, it } from "vitest";
import { correctionFailure, itemsBackHome, newestWorn } from "./correction";

describe("a correction after wearing (DESIGN.md 5.1 item 1)", () => {
  it("a failed record says nothing changed and retries the whole correction", () =>
    expect(correctionFailure("record")).toEqual({ messageKey: "today.status.correctionNotSaved", retries: "whole correction" }));
  it("a failed delete says the earlier record was kept and retries only the delete", () =>
    expect(correctionFailure("delete")).toEqual({ messageKey: "today.status.correctionOldKept", retries: "delete only" }));
  it("brings home only what the earlier wear laundered and the corrected outfit does not hold", () => {
    expect(itemsBackHome(["polo", "jeans"], ["shirt", "jeans", "sneakers"])).toEqual(["polo"]);
    expect(itemsBackHome(null, ["shirt"])).toEqual([]);
  });
  it("after a reload with two worn records the day shows the newest", () => {
    const records = [
      { id: "earlier", feedback: "worn" },
      { id: "skip", feedback: "skipped" },
      { id: "corrected", feedback: "worn" },
    ];
    expect(newestWorn(records)?.id).toBe("corrected");
    expect(newestWorn([{ id: "s", feedback: "skipped" }])).toBeNull();
  });
});
