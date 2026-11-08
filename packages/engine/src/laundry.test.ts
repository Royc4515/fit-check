import { describe, expect, it } from "vitest";
import { ItemSchema, type Item } from "@fit-check/schema";
import wardrobeJson from "../__fixtures__/wardrobe.json";
import { dueForLaundry } from "./laundry";

const wardrobe: Item[] = (wardrobeJson as unknown[]).map((row) => ItemSchema.parse(row));
const first = (sub: string) => wardrobe.find((i) => i.tags.subcategory === sub)!;

describe("dueForLaundry", () => {
  const tee = first("tshirt");
  const shirt = first("button_down");
  const jeans = first("jeans");
  const shoes = first("sneakers");

  it("sends a T-shirt after one wear but keeps jeans and a button-down", () => {
    const counts = new Map([[tee.id, 1], [shirt.id, 1], [jeans.id, 1]]);
    expect(dueForLaundry([tee, shirt, jeans], counts).map((i) => i.id)).toEqual([tee.id]);
  });

  it("sends a button-down on its third wear and jeans on their sixth", () => {
    expect(dueForLaundry([shirt], new Map([[shirt.id, 2]]))).toEqual([]);
    expect(dueForLaundry([shirt], new Map([[shirt.id, 3]]))).toEqual([shirt]);
    expect(dueForLaundry([jeans], new Map([[jeans.id, 5]]))).toEqual([]);
    expect(dueForLaundry([jeans], new Map([[jeans.id, 6]]))).toEqual([jeans]);
  });

  it("never sends shoes, and treats a missing count as zero", () => {
    expect(dueForLaundry([shoes], new Map([[shoes.id, 50]]))).toEqual([]);
    expect(dueForLaundry([tee], new Map())).toEqual([]);
  });

  it("leaves items that are not at home where they are", () => {
    const away = { ...tee, availability: "away" as const };
    expect(dueForLaundry([away], new Map([[tee.id, 3]]))).toEqual([]);
  });
});
