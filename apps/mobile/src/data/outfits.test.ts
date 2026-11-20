import type { Item } from "@fit-check/schema";
import { SUBCATEGORY_TO_CATEGORY } from "@fit-check/schema";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeSupabase, type FakeCall, type FakeResponse } from "./__fixtures__/fakeSupabase";

// The requests of the saved-outfit data layer against a recording stand-in for supabase-js: validation before any
// request, the duplicate rule, no orphan row after a failed outfit_items insert, and the remove decision. The rules
// themselves are covered in savedOutfit.test.ts.
const state = vi.hoisted(() => ({ respond: (_: unknown): unknown => ({}), preview: false }));
let fake = fakeSupabase((c) => state.respond(c) as FakeResponse);
vi.mock("../lib/supabase", () => ({ supabase: { from: (t: string) => fake.client.from(t) } }));
vi.mock("./preview", () => ({
  isPreview: () => state.preview,
  getSnapshot: () => Promise.reject(new Error("no preview")),
  PreviewReadOnlyError: class PreviewReadOnlyError extends Error {},
}));

const { fetchSavedOutfits, markOutfitSaved, removeSavedOutfit, renameOutfit, saveOutfit, setOutfitFavorite, updateSavedOutfit } = await import("./outfits");
const { SavedOutfitError } = await import("./savedOutfit");

function use(respond: (c: FakeCall) => FakeResponse) {
  state.respond = (c) => respond(c as FakeCall);
  fake = fakeSupabase((c) => state.respond(c) as FakeResponse);
}
const ops = () => fake.calls.map((c) => `${c.op} ${c.table}`);
const isReadById = (c: FakeCall) => c.op === "select" && c.filters.some((f) => f[0] === "maybeSingle");

function item(id: string, sub: "tshirt" | "chinos" | "sneakers"): Item {
  return {
    id,
    name: id,
    brand: null,
    tags: { category: SUBCATEGORY_TO_CATEGORY[sub], subcategory: sub, color_name: "white", color_hex: "#F4F1EA", secondary_color_hex: null, pattern: "solid", material: "cotton", sleeve: "short", fit: "regular", seasons: ["summer"], formality: 3, temp_min_c: 10, temp_max_c: 35, modesty_flags: [], style_tags: [] },
    status: "active",
    availability: "home",
    source: "photo",
    price: null,
    currency: null,
    purchased_at: null,
    cutout_path: null,
    notes: null,
  };
}

function outfitRow(id: string, savedAt: string | null, wears: { worn_on: string; feedback: string }[] = []) {
  return {
    id,
    name: null,
    is_favorite: false,
    saved_at: savedAt,
    context_type: "weekday",
    source: "manual",
    created_for_date: "2026-11-19",
    outfit_items: [
      { item_id: "t1", slot: "top", item: item("t1", "tshirt") },
      { item_id: "b1", slot: "bottom", item: item("b1", "chinos") },
      { item_id: "s1", slot: "shoes", item: item("s1", "sneakers") },
    ],
    wears,
  };
}

const pieces = [
  { item_id: "t1", slot: "top" as const },
  { item_id: "b1", slot: "bottom" as const },
  { item_id: "s1", slot: "shoes" as const },
];
const saveArgs = { userId: "u1", date: "2026-11-19", contextType: "weekday" as const, source: "manual" as const, pieces, now: new Date("2026-11-19T08:00:00Z") };

beforeEach(() => {
  state.preview = false;
});

describe("saveOutfit", () => {
  it("rejects an invalid outfit and an over-long name before any request", async () => {
    use(() => ({}));
    await expect(saveOutfit({ ...saveArgs, pieces: pieces.slice(0, 2) })).rejects.toMatchObject({ code: "invalid_outfit" });
    await expect(saveOutfit({ ...saveArgs, name: "x".repeat(41) })).rejects.toMatchObject({ code: "name_too_long" });
    await expect(saveOutfit({ ...saveArgs, date: "19.11.2026" })).rejects.toBeInstanceOf(SavedOutfitError);
    expect(fake.calls).toEqual([]);
  });

  it("returns the saved outfit with the same garments (other order) and writes nothing", async () => {
    use((c) => {
      if (isReadById(c)) return { data: outfitRow("o1", "2026-11-10T08:00:00Z") };
      return { data: [{ id: "o1", outfit_items: [{ item_id: "s1" }, { item_id: "t1" }, { item_id: "b1" }] }] };
    });
    const result = await saveOutfit(saveArgs);
    expect(result.created).toBe(false);
    expect(result.outfit.id).toBe("o1");
    expect(ops()).toEqual(["select outfits", "select outfits"]);
  });

  it("creates a new saved row with its garments, the trimmed name and the caller's date", async () => {
    use((c) => {
      if (c.op === "insert" && c.table === "outfits") return { data: { id: "o2" } };
      if (isReadById(c)) return { data: { ...outfitRow("o2", "2026-11-19T08:00:00Z"), name: "שישי" } };
      if (c.op === "select") return { data: [] };
      return {};
    });
    const result = await saveOutfit({ ...saveArgs, name: "  שישי " });
    expect(result.created).toBe(true);
    expect(ops()).toEqual(["select outfits", "insert outfits", "insert outfit_items", "select outfits"]);
    expect(fake.calls[1]!.payload).toEqual({ user_id: "u1", context_type: "weekday", created_for_date: "2026-11-19", source: "manual", name: "שישי", saved_at: "2026-11-19T08:00:00.000Z" });
    expect(fake.calls[2]!.payload).toEqual(pieces.map((p) => ({ outfit_id: "o2", ...p })));
  });

  it("leaves no orphan row when the outfit_items insert fails", async () => {
    use((c) => {
      if (c.op === "insert" && c.table === "outfits") return { data: { id: "o3" } };
      if (c.op === "insert" && c.table === "outfit_items") return { error: new Error("boom") };
      if (c.op === "select") return { data: [] };
      return {};
    });
    await expect(saveOutfit(saveArgs)).rejects.toThrow("boom");
    expect(ops()).toEqual(["select outfits", "insert outfits", "insert outfit_items", "delete outfits"]);
    expect(fake.calls[3]!.filters).toEqual([["eq", "id", "o3"]]);
  });

  it("shares one request between two saves of the same set at once", async () => {
    use((c) => {
      if (c.op === "insert" && c.table === "outfits") return { data: { id: "o4" } };
      if (isReadById(c)) return { data: outfitRow("o4", "2026-11-19T08:00:00Z") };
      if (c.op === "select") return { data: [] };
      return {};
    });
    const [a, b] = await Promise.all([saveOutfit(saveArgs), saveOutfit({ ...saveArgs, pieces: [...pieces].reverse() })]);
    expect([a.created, b.created]).toEqual([true, false]);
    expect(ops().filter((o) => o === "insert outfits")).toHaveLength(1);
  });

  it("rejects in the design preview", async () => {
    state.preview = true;
    use(() => ({}));
    await expect(saveOutfit(saveArgs)).rejects.toThrow();
    expect(fake.calls).toEqual([]);
  });
});

describe("markOutfitSaved", () => {
  it("sets saved_at on the same row, guarded on it being unsaved", async () => {
    let saved = false;
    use((c) => {
      if (c.op === "update") {
        saved = true;
        return {};
      }
      if (isReadById(c)) return { data: outfitRow("w1", saved ? "2026-11-19T08:00:00Z" : null, [{ worn_on: "2026-11-12", feedback: "worn" }]) };
      return { data: [] };
    });
    const result = await markOutfitSaved("w1", { now: new Date("2026-11-19T08:00:00Z") });
    expect(result).toMatchObject({ created: true, outfit: { id: "w1", wornCount: 1, lastWornOn: "2026-11-12" } });
    const update = fake.calls.find((c) => c.op === "update")!;
    expect(update.payload).toEqual({ saved_at: "2026-11-19T08:00:00.000Z" });
    expect(update.filters).toEqual([
      ["eq", "id", "w1"],
      ["is", "saved_at", null],
    ]);
  });

  it("returns the saved outfit with the same garments and leaves this row unsaved", async () => {
    use((c) => {
      if (isReadById(c)) return { data: c.filters.some((f) => f[2] === "o1") ? outfitRow("o1", "2026-11-10T08:00:00Z") : outfitRow("w1", null) };
      return { data: [{ id: "o1", outfit_items: pieces.map((p) => ({ item_id: p.item_id })) }] };
    });
    const result = await markOutfitSaved("w1");
    expect(result).toMatchObject({ created: false, outfit: { id: "o1" } });
    expect(fake.calls.some((c) => c.op === "update")).toBe(false);
  });

  it("is not_found for a missing row", async () => {
    use(() => ({ data: null }));
    await expect(markOutfitSaved("nope")).rejects.toMatchObject({ code: "not_found" });
  });
});

describe("removeSavedOutfit", () => {
  it("keeps a worn outfit as an unsaved row, favourite cleared", async () => {
    use((c) => (c.op === "select" ? { data: { saved_at: "2026-11-10T08:00:00Z", wears: [{ id: "w1" }] } } : {}));
    expect(await removeSavedOutfit("o1")).toBe("unsaved");
    expect(fake.calls[1]).toMatchObject({ op: "update", payload: { saved_at: null, is_favorite: false } });
  });

  it("deletes an outfit that was never worn", async () => {
    use((c) => (c.op === "select" ? { data: { saved_at: "2026-11-10T08:00:00Z", wears: [] } } : {}));
    expect(await removeSavedOutfit("o1")).toBe("deleted");
    expect(ops()).toEqual(["select outfits", "delete outfits"]);
  });

  it("refuses an outfit that is not saved", async () => {
    use(() => ({ data: { saved_at: null, wears: [] } }));
    await expect(removeSavedOutfit("o1")).rejects.toMatchObject({ code: "not_saved" });
    expect(ops()).toEqual(["select outfits"]);
  });
});

describe("favourite and name", () => {
  it("only touches a saved outfit, and says so when none matched", async () => {
    use(() => ({ data: [] }));
    await expect(setOutfitFavorite("o1", true)).rejects.toMatchObject({ code: "not_saved" });
    expect(fake.calls[0]!.filters).toContainEqual(["not", "saved_at", "is", null]);
  });

  it("renames with a trimmed name, clears with an empty one, and rejects 41 characters before any request", async () => {
    use(() => ({ data: [{ id: "o1" }] }));
    expect(await renameOutfit("o1", "  ערב ")).toBe("ערב");
    expect(fake.calls[0]!.payload).toEqual({ name: "ערב" });
    expect(await renameOutfit("o1", "   ")).toBeNull();
    use(() => ({}));
    await expect(renameOutfit("o1", "x".repeat(41))).rejects.toMatchObject({ code: "name_too_long" });
    expect(fake.calls).toEqual([]);
  });
});

describe("fetchSavedOutfits", () => {
  it("reads only saved rows, newest first, and answers none in the design preview", async () => {
    use(() => ({ data: [outfitRow("a", "2026-11-01T08:00:00Z"), outfitRow("b", "2026-11-18T08:00:00Z")] }));
    expect((await fetchSavedOutfits()).map((o) => o.id)).toEqual(["b", "a"]);
    expect(fake.calls[0]!.filters).toContainEqual(["not", "saved_at", "is", null]);
    state.preview = true;
    use(() => ({}));
    expect(await fetchSavedOutfits()).toEqual([]);
    expect(fake.calls).toEqual([]);
  });
});

describe("updateSavedOutfit", () => {
  // One outfit row "o1" and its outfit_items, changed by the requests as a database would, so the order of writes
  // and what a failure leaves behind can be asserted. "o2" is another saved outfit (t2, b1, s1).
  type Row = { item_id: string; slot: "top" | "bottom" | "shoes" | "layer" };
  const before: Row[] = [
    { item_id: "t1", slot: "top" },
    { item_id: "b1", slot: "bottom" },
    { item_id: "s1", slot: "shoes" },
  ];
  const after = [
    { item_id: "t3", slot: "top" as const },
    { item_id: "b1", slot: "bottom" as const },
    { item_id: "s1", slot: "shoes" as const },
    { item_id: "l1", slot: "layer" as const },
  ];
  const edit = { garments: after, contextType: "shabbat" as const, name: "  שבת " };

  // `use` under another name: the hooks lint rule reads any `use(...)` inside a named function as a React hook.
  const answer = use;
  function model(failAt: string | null) {
    const db = { items: [...before], row: { context_type: "weekday", name: null as string | null, saved_at: "2026-11-10T08:00:00Z" } };
    answer((c) => {
      const step = `${c.op} ${c.table}`;
      if (failAt === step) return { error: new Error(`failed: ${step}`) };
      if (c.table === "outfit_items" && c.op === "insert") db.items.push(...(c.payload as (Row & { outfit_id: string })[]).map(({ item_id, slot }) => ({ item_id, slot })));
      if (c.table === "outfit_items" && c.op === "delete") {
        const gone = c.filters.find((f) => f[0] === "in")![2] as string[];
        db.items = db.items.filter((i) => !gone.includes(i.item_id));
      }
      if (c.table === "outfits" && c.op === "update") {
        Object.assign(db.row, c.payload);
        return { data: [{ id: "o1" }] };
      }
      if (c.op === "select" && c.payload === "saved_at,outfit_items(item_id,slot)") return { data: { saved_at: db.row.saved_at, outfit_items: db.items } };
      if (c.op === "select" && c.payload === "id,outfit_items(item_id)") {
        return { data: [{ id: "o1", outfit_items: db.items }, { id: "o2", outfit_items: [{ item_id: "t2" }, { item_id: "b1" }, { item_id: "s1" }] }] };
      }
      if (isReadById(c)) return { data: { ...outfitRow("o1", db.row.saved_at), context_type: db.row.context_type, name: db.row.name } };
      return {};
    });
    return db;
  }

  it("inserts what it gains, deletes what it loses, then updates the row; keeps saved_at", async () => {
    const db = model(null);
    const outfit = await updateSavedOutfit("o1", edit);
    expect(ops()).toEqual(["select outfits", "select outfits", "insert outfit_items", "delete outfit_items", "update outfits", "select outfits"]);
    expect(fake.calls[2]!.payload).toEqual([
      { outfit_id: "o1", item_id: "t3", slot: "top" },
      { outfit_id: "o1", item_id: "l1", slot: "layer" },
    ]);
    expect(fake.calls[3]!.filters).toEqual([
      ["eq", "outfit_id", "o1"],
      ["in", "item_id", ["t1"]],
    ]);
    expect(fake.calls[4]!.payload).toEqual({ context_type: "shabbat", name: "שבת" });
    expect(fake.calls[4]!.filters).toContainEqual(["not", "saved_at", "is", null]);
    expect(db.items.map((i) => i.item_id).sort()).toEqual(["b1", "l1", "s1", "t3"]);
    expect(outfit.id).toBe("o1");
  });

  it("never leaves part of a set at a failing step (the old one until the garments are written), and a retry finishes", async () => {
    for (const failAt of ["insert outfit_items", "delete outfit_items", "update outfits"]) {
      const db = model(failAt);
      await expect(updateSavedOutfit("o1", edit)).rejects.toThrow(`failed: ${failAt}`);
      const ids = db.items.map((i) => i.item_id);
      // Whole old set or whole new set, never part of one: the outfit always has a top, a bottom and shoes.
      const whole = (set: readonly { item_id: string }[]) => set.every((g) => ids.includes(g.item_id));
      expect(whole(before) || whole(after), failAt).toBe(true);
      if (failAt !== "update outfits") for (const old of before) expect(ids, failAt).toContain(old.item_id);
      // The retry, as "נסה שוב" sends it: the same edit, now without the failure.
      const items = db.items;
      const row = db.row;
      use((c) => {
        if (c.table === "outfit_items" && c.op === "insert") items.push(...(c.payload as (Row & { outfit_id: string })[]).map(({ item_id, slot }) => ({ item_id, slot })));
        if (c.table === "outfit_items" && c.op === "delete") {
          const gone = c.filters.find((f) => f[0] === "in")![2] as string[];
          for (let n = items.length - 1; n >= 0; n--) if (gone.includes(items[n]!.item_id)) items.splice(n, 1);
        }
        if (c.table === "outfits" && c.op === "update") {
          Object.assign(row, c.payload);
          return { data: [{ id: "o1" }] };
        }
        if (c.op === "select" && c.payload === "saved_at,outfit_items(item_id,slot)") return { data: { saved_at: row.saved_at, outfit_items: items } };
        if (c.op === "select" && c.payload === "id,outfit_items(item_id)") return { data: [{ id: "o1", outfit_items: items }] };
        if (isReadById(c)) return { data: outfitRow("o1", row.saved_at) };
        return {};
      });
      await updateSavedOutfit("o1", edit);
      expect(items.map((i) => i.item_id).sort(), failAt).toEqual(["b1", "l1", "s1", "t3"]);
      expect(fake.calls.filter((c) => c.op === "insert").length, failAt).toBeLessThanOrEqual(1);
      expect(row).toMatchObject({ context_type: "shabbat", name: "שבת" });
    }
  });

  it("refuses the garments of another saved outfit, naming it, and writes nothing", async () => {
    model(null);
    const err = await updateSavedOutfit("o1", { ...edit, garments: [{ item_id: "s1", slot: "shoes" }, { item_id: "t2", slot: "top" }, { item_id: "b1", slot: "bottom" }] }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SavedOutfitError);
    expect(err).toMatchObject({ code: "same_garments", otherId: "o2" });
    expect(fake.calls.some((c) => c.op !== "select")).toBe(false);
  });

  it("changes only the row when the garments are the same (another order)", async () => {
    model(null);
    await updateSavedOutfit("o1", { garments: [...before].reverse(), contextType: "date", name: null });
    expect(ops()).toEqual(["select outfits", "select outfits", "update outfits", "select outfits"]);
    expect(fake.calls[2]!.payload).toEqual({ context_type: "date", name: null });
  });

  it("validates before any request, refuses an unsaved row, and rejects in the design preview", async () => {
    use(() => ({}));
    await expect(updateSavedOutfit("o1", { ...edit, garments: after.slice(1) })).rejects.toMatchObject({ code: "invalid_outfit" });
    await expect(updateSavedOutfit("o1", { ...edit, name: "x".repeat(41) })).rejects.toMatchObject({ code: "name_too_long" });
    expect(fake.calls).toEqual([]);
    use(() => ({ data: { saved_at: null, outfit_items: before } }));
    await expect(updateSavedOutfit("o1", edit)).rejects.toMatchObject({ code: "not_saved" });
    use(() => ({ data: null }));
    await expect(updateSavedOutfit("o1", edit)).rejects.toMatchObject({ code: "not_found" });
    state.preview = true;
    use(() => ({}));
    await expect(updateSavedOutfit("o1", edit)).rejects.toThrow();
    expect(fake.calls).toEqual([]);
  });
});
