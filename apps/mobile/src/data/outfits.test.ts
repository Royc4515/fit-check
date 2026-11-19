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

const { fetchSavedOutfits, markOutfitSaved, removeSavedOutfit, renameOutfit, saveOutfit, setOutfitFavorite } = await import("./outfits");
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
