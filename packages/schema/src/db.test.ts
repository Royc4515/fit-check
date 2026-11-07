import { describe, expect, it } from "vitest";
import wardrobeJson from "../../engine/__fixtures__/wardrobe.json";
import { ItemSchema, type Item } from "./item";
import { itemFromRow, itemToInsertRow, orderPair } from "./db";

const wardrobe: Item[] = (wardrobeJson as unknown[]).map((row) => ItemSchema.parse(row));
const USER = "00000000-0000-4000-8000-000000000001";

/** What PostgREST would hand back for the columns the app selects, given an insert row. */
function asReadRow(item: Item, id: string) {
  const r = itemToInsertRow(item, USER);
  return {
    id,
    name: r.name,
    brand: r.brand,
    tags: r.tags,
    status: r.status,
    availability: r.availability,
    source: r.source,
    price: r.price,
    currency: r.currency,
    purchased_at: r.purchased_at,
    cutout_path: r.cutout_path,
    notes: r.notes,
  };
}

describe("items row mapping", () => {
  it("round-trips every real wardrobe item (the DB id replaces the sheet id)", () => {
    expect(wardrobe.length).toBeGreaterThan(90);
    for (const item of wardrobe) {
      const back = itemFromRow(asReadRow(item, "11111111-1111-4111-8111-111111111111"));
      expect(back).toEqual({ ...item, id: "11111111-1111-4111-8111-111111111111" });
    }
  });

  it("derives the hot columns from tags, so they can never disagree", () => {
    for (const item of wardrobe) {
      const r = itemToInsertRow(item, USER);
      expect(r.category).toBe(item.tags.category);
      expect(r.subcategory).toBe(item.tags.subcategory);
      expect(r.formality).toBe(item.tags.formality);
      expect(r.temp_min_c).toBeLessThanOrEqual(r.temp_max_c);
      expect(r.external_id).toBe(item.id);
      expect(r.user_id).toBe(USER);
    }
  });

  it("accepts numeric prices as strings (PostgREST does that for inexact values)", () => {
    const item = wardrobe[0] as Item;
    const row = { ...asReadRow(item, "id-1"), price: "129.90" };
    expect(itemFromRow(row).price).toBe(129.9);
  });

  it("rejects a row whose tags violate the frozen schema instead of coercing it", () => {
    const item = wardrobe[0] as Item;
    const row = { ...asReadRow(item, "id-1"), tags: { ...item.tags, formality: 11 } };
    expect(() => itemFromRow(row)).toThrow();
  });

  it("rejects a row with an unknown status", () => {
    const item = wardrobe[0] as Item;
    expect(() => itemFromRow({ ...asReadRow(item, "id-1"), status: "stolen" })).toThrow();
  });
});

describe("orderPair", () => {
  it("is symmetric and puts the smaller uuid first", () => {
    const a = "0aaaaaaa-0000-4000-8000-000000000000";
    const b = "ffffffff-0000-4000-8000-000000000000";
    expect(orderPair(a, b)).toEqual([a, b]);
    expect(orderPair(b, a)).toEqual([a, b]);
  });
});
