import { ItemSchema, type Item } from "@fit-check/schema";
import { describe, expect, it } from "vitest";
import wardrobeJson from "../../../../../packages/engine/__fixtures__/wardrobe.json";
import { correctedPieces, tapHintFit } from "./pieces";

const wardrobe: Item[] = (wardrobeJson as unknown[]).map((row) => ItemSchema.parse(row));
const byId = (id: string) => wardrobe.find((i) => i.id === id)!;

describe("correctedPieces", () => {
  const worn = ["105", "201", "704"].map(byId);
  it("replaces the one garment, keeps the rest and their order", () =>
    expect(correctedPieces(worn, "201", byId("204")).map((i) => i.id)).toEqual(["105", "204", "704"]));
  it("an archived garment in the worn outfit stays in the correction", () => {
    const archived = { ...byId("704"), status: "archived" as const };
    expect(correctedPieces([byId("105"), byId("201"), archived], "201", byId("204")).map((i) => [i.id, i.status])).toEqual([
      ["105", "active"],
      ["204", "active"],
      ["704", "archived"],
    ]);
  });
  it("an id not in the outfit changes nothing", () => expect(correctedPieces(worn, "999", byId("204")).map((i) => i.id)).toEqual(["105", "201", "704"]));
});

describe("tapHintFit (the hint never pushes garments under the bar)", () => {
  const base = { decided: null, measured: true, floor: 300, hintBlock: 68, desktop: false } as const;
  it("waits for the measurement", () => expect(tapHintFit({ ...base, measured: false, space: 900 })).toBeNull());
  it("shows when the hero keeps its floor with the hint", () => expect(tapHintFit({ ...base, space: 368 })).toBe("show"));
  it("holds it back when the hint would put the hero under its floor", () => expect(tapHintFit({ ...base, space: 367 })).toBe("hide"));
  it("withdraws a shown hint when a later line takes its room, and never brings it back on this visit", () => {
    expect(tapHintFit({ ...base, decided: "show", space: 299 })).toBe("hide");
    expect(tapHintFit({ ...base, decided: "hide", space: 900 })).toBe("hide");
  });
  it("a shown hint that still fits stays", () => expect(tapHintFit({ ...base, decided: "show", space: 300 })).toBe("show"));
  it("desktop always has room", () => expect(tapHintFit({ ...base, desktop: true, space: 0 })).toBe("show"));
});
