import { ItemSchema, type Item } from "@fit-check/schema";
import { describe, expect, it } from "vitest";
import wardrobeJson from "../../../../../packages/engine/__fixtures__/wardrobe.json";
import { correctedPieces } from "./pieces";

const wardrobe: Item[] = (wardrobeJson as unknown[]).map((row) => ItemSchema.parse(row));
const byId = (id: string) => wardrobe.find((i) => i.id === id)!;

describe("correctedPieces", () => {
  const worn = ["105", "201", "704"].map(byId);
  it("replaces the one garment, keeps the rest and their order", () =>
    expect(correctedPieces(worn, "201", byId("204")).map((i) => i.id)).toEqual(["105", "204", "704"]));
  it("an id not in the outfit changes nothing", () => expect(correctedPieces(worn, "999", byId("204")).map((i) => i.id)).toEqual(["105", "201", "704"]));
});
