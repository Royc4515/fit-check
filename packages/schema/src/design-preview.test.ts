import { describe, expect, it } from "vitest";
import wardrobeJson from "../../engine/__fixtures__/wardrobe.json";
import { ItemSchema, type Item } from "./item";
import { itemFromRow, itemToInsertRow, WearRowSchema } from "./db";
import { parseDesignPreviewSnapshot } from "./design-preview";

const wardrobe: Item[] = (wardrobeJson as unknown[]).map((row) => ItemSchema.parse(row));
const OWNER = "00000000-0000-4000-8000-000000000001";

/** An items row as the function selects it (ITEM_READ_COLUMNS), from a fixture item. */
function itemRow(item: Item, id: string) {
  const r = itemToInsertRow(item, OWNER);
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

const wear = {
  id: "w1",
  worn_on: "2026-11-17",
  feedback: "worn",
  outfit_id: "o1",
  outfits: { breakdown: { total: 0.8, adjustment: { temp_steps: 1, formality_steps: 0 } }, outfit_items: [{ item_id: "i1" }] },
};

function snapshot(overrides: Record<string, unknown> = {}) {
  return {
    ok: true,
    owner: OWNER,
    expires_at: "2026-11-25T16:00:00Z",
    items: wardrobe.slice(0, 5).map((item, n) => itemRow(item, `i${n + 1}`)),
    pair_weights: [{ item_a: "i1", item_b: "i2", weight: 0.4 }, { item_a: "i1", item_b: "i3", weight: "0.125" }],
    wears: [wear],
    redraw_specs: [{ id: "i1", redraw_spec: { details: [] } }],
    ...overrides,
  };
}

describe("parseDesignPreviewSnapshot", () => {
  it("accepts the function's shape, and its rows parse with the same row schemas the live reads use", () => {
    const snap = parseDesignPreviewSnapshot(JSON.parse(JSON.stringify(snapshot())));
    expect(snap).not.toBeNull();
    const items = snap!.items.map((row) => itemFromRow(row));
    expect(items.map((i) => i.id)).toEqual(["i1", "i2", "i3", "i4", "i5"]);
    expect(items[0]).toEqual({ ...wardrobe[0], id: "i1" });
    expect(WearRowSchema.parse(snap!.wears[0]).outfits?.breakdown?.adjustment).toEqual({ temp_steps: 1, formality_steps: 0 });
    expect(snap!.pair_weights.map((p) => Number(p.weight))).toEqual([0.4, 0.125]);
  });

  it("keeps a malformed item or wear row for the read path to skip, instead of failing the whole preview", () => {
    const snap = parseDesignPreviewSnapshot(snapshot({ items: [{ id: "bad" }], wears: [{ feedback: "loved" }] }));
    expect(snap).not.toBeNull();
    expect(() => itemFromRow(snap!.items[0])).toThrow();
    expect(WearRowSchema.safeParse(snap!.wears[0]).success).toBe(false);
  });

  it("returns null for the error bodies (wrong code, expired) and for a changed shape", () => {
    expect(parseDesignPreviewSnapshot({ ok: false, reason: "unauthorized" })).toBeNull();
    expect(parseDesignPreviewSnapshot({ ok: false, reason: "expired" })).toBeNull();
    expect(parseDesignPreviewSnapshot(snapshot({ pair_weights: [{ item_a: "i1" }] }))).toBeNull();
    expect(parseDesignPreviewSnapshot(snapshot({ items: undefined }))).toBeNull();
    expect(parseDesignPreviewSnapshot("<html>")).toBeNull();
    expect(parseDesignPreviewSnapshot(null)).toBeNull();
  });
});
