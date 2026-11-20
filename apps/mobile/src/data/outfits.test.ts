import type { Item } from "@fit-check/schema";
import { SUBCATEGORY_TO_CATEGORY } from "@fit-check/schema";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeSupabase, type FakeCall, type FakeResponse } from "./__fixtures__/fakeSupabase";

// The requests of the saved-outfit data layer against a recording stand-in for supabase-js: validation before any
// request, the duplicate rule, no orphan row after a failed outfit_items insert, and the remove decision. The rules
// themselves are covered in savedOutfit.test.ts.
// `wears`: what the worn-wears read (table "wears") answers; null hands that read to the test's own responder.
const state = vi.hoisted(() => ({ respond: (_: unknown): unknown => ({}), preview: false, wears: [] as unknown[] | null }));
let fake = fakeSupabase((c) => state.respond(c) as FakeResponse);
vi.mock("../lib/supabase", () => ({ supabase: { from: (t: string) => fake.client.from(t) } }));
vi.mock("./preview", () => ({
  isPreview: () => state.preview,
  getSnapshot: () => Promise.reject(new Error("no preview")),
  PreviewReadOnlyError: class PreviewReadOnlyError extends Error {},
}));

const { fetchSavedOutfit, fetchSavedOutfits, markOutfitSaved, removeSavedOutfit, renameOutfit, saveOutfit, setOutfitFavorite, updateSavedOutfit } = await import("./outfits");
const { SavedOutfitError } = await import("./savedOutfit");

function use(respond: (c: FakeCall) => FakeResponse) {
  state.respond = (c) => {
    const call = c as FakeCall;
    return call.table === "wears" && call.op === "select" && state.wears !== null ? { data: state.wears } : respond(call);
  };
  fake = fakeSupabase((c) => state.respond(c) as FakeResponse);
}
// The worn-wears read behind every outfit read is covered by its own tests (fetchSavedOutfits); the write-sequence
// assertions leave it out.
const ops = () => fake.calls.filter((c) => c.table !== "wears").map((c) => `${c.op} ${c.table}`);
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

let wornRows = 0;
/** A worn wear as the worn-wears read returns it: its date and the item ids of the outfit row it points at. */
function wornRow(worn_on: string, itemIds: string[] | null) {
  return { id: `w${++wornRows}`, worn_on, outfits: itemIds && { outfit_items: itemIds.map((item_id) => ({ item_id })) } };
}

const pieces = [
  { item_id: "t1", slot: "top" as const },
  { item_id: "b1", slot: "bottom" as const },
  { item_id: "s1", slot: "shoes" as const },
];
const saveArgs = { userId: "u1", date: "2026-11-19", contextType: "weekday" as const, source: "manual" as const, pieces, now: new Date("2026-11-19T08:00:00Z") };

beforeEach(() => {
  vi.restoreAllMocks();
  state.preview = false;
  state.wears = [];
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
    state.wears = [wornRow("2026-11-12", ["t1", "b1", "s1"])];
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

describe("wear count by garment set (fetchSavedOutfits, fetchSavedOutfit)", () => {
  const SET = ["t1", "b1", "s1"];
  const wearsCalls = () => fake.calls.filter((c) => c.table === "wears");

  it("three unsaved rows of one set worn on three days, one of them saved: 3 and the newest date, in two requests", async () => {
    // The saved row is the middle one; its own embedded wear is one of the three the wears read returns.
    state.wears = [wornRow("2026-11-18", SET), wornRow("2026-11-12", ["s1", "t1", "b1"]), wornRow("2026-11-05", SET)];
    use((c) => (c.table === "outfits" ? { data: [outfitRow("u2", "2026-11-19T08:00:00Z", [{ worn_on: "2026-11-12", feedback: "worn" }])] } : {}));
    const [o] = await fetchSavedOutfits();
    expect(o).toMatchObject({ id: "u2", wornCount: 3, lastWornOn: "2026-11-18", wearCount: 1 });
    expect(fake.calls.map((c) => c.table).sort()).toEqual(["outfits", "wears"]);
    expect(wearsCalls()[0]!.filters).toContainEqual(["eq", "feedback", "worn"]);
  });

  it("counts only the wears the read returns: a skip on the row, a different set and a deleted outfit add nothing", async () => {
    state.wears = [wornRow("2026-11-18", ["t2", "b1", "s1"]), wornRow("2026-11-17", [...SET, "l1"]), wornRow("2026-11-16", null), wornRow("2026-11-02", SET)];
    use((c) => (c.table === "outfits" ? { data: [outfitRow("o1", "2026-11-10T08:00:00Z", [{ worn_on: "2026-11-09", feedback: "skipped" }, { worn_on: "2026-11-02", feedback: "worn" }])] } : {}));
    const [o] = await fetchSavedOutfits();
    // wornCount 1 (the wear on 11-02, once, though the row's embedded wears list it too), wearCount 2 (any feedback).
    expect(o).toMatchObject({ wornCount: 1, lastWornOn: "2026-11-02", wearCount: 2 });
  });

  it("reads the next page when the first is full, and counts across both", async () => {
    const page1 = Array.from({ length: 1000 }, (_, n) => wornRow("2026-10-01", [`x${n}`, "b1", "s1"]));
    state.wears = null;
    use((c) => {
      if (c.table === "outfits") return { data: [outfitRow("o1", "2026-11-10T08:00:00Z")] };
      const range = c.filters.find((f) => f[0] === "range")!;
      return { data: range[1] === 0 ? page1 : [wornRow("2026-09-01", SET)] };
    });
    const [o] = await fetchSavedOutfits();
    expect(o).toMatchObject({ wornCount: 1, lastWornOn: "2026-09-01" });
    expect(wearsCalls().map((c) => c.filters.find((f) => f[0] === "range")!.slice(1))).toEqual([
      [0, 999],
      [1000, 1999],
    ]);
  });

  it("falls back to the row's own worn wears, and still loads the collection, when the wears read fails", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    state.wears = null;
    const own = [{ worn_on: "2026-11-02", feedback: "worn" }, { worn_on: "2026-11-09", feedback: "worn" }, { worn_on: "2026-11-11", feedback: "skipped" }];
    use((c) => (c.table === "wears" ? { error: new Error("wears down") } : { data: [outfitRow("o1", "2026-11-10T08:00:00Z", own)] }));
    const [o] = await fetchSavedOutfits();
    expect(o).toMatchObject({ id: "o1", wornCount: 2, lastWornOn: "2026-11-09", wearCount: 3 });
    expect(log).toHaveBeenCalled();
  });

  it("an outfits read that fails still throws", async () => {
    use((c) => (c.table === "outfits" ? { error: new Error("outfits down") } : {}));
    await expect(fetchSavedOutfits()).rejects.toThrow("outfits down");
  });

  it("one saved outfit counts by set too, and is null when it is not saved", async () => {
    state.wears = [wornRow("2026-11-18", SET), wornRow("2026-11-05", SET), wornRow("2026-11-01", SET)];
    use((c) => (c.table === "outfits" ? { data: outfitRow("o1", "2026-11-10T08:00:00Z") } : {}));
    expect(await fetchSavedOutfit("o1")).toMatchObject({ wornCount: 3, lastWornOn: "2026-11-18", wearCount: 0 });
    expect(fake.calls).toHaveLength(2);
    use((c) => (c.table === "outfits" ? { data: outfitRow("o1", null) } : {}));
    expect(await fetchSavedOutfit("o1")).toBeNull();
  });

  it("removal still goes by the row's own wears: a saved build never worn on its own row is deleted, though its set was worn on other rows", async () => {
    state.wears = [wornRow("2026-11-18", SET), wornRow("2026-11-05", SET)];
    use((c) => {
      if (c.table === "outfits" && c.op === "select" && c.payload === "saved_at,wears(id)") return { data: { saved_at: "2026-11-19T08:00:00Z", wears: [] } };
      if (c.table === "outfits" && c.op === "select") return { data: [outfitRow("built", "2026-11-19T08:00:00Z")] };
      return {};
    });
    expect(await fetchSavedOutfits()).toMatchObject([{ id: "built", wornCount: 2, wearCount: 0 }]);
    fake.calls.length = 0;
    expect(await removeSavedOutfit("built")).toBe("deleted");
    expect(ops()).toEqual(["select outfits", "delete outfits"]);
    expect(wearsCalls()).toEqual([]);
  });
});

describe("updateSavedOutfit", () => {
  // A small database of outfits, outfit_items and wears that the requests change, so the order of writes and what a
  // failure leaves behind can be asserted. "o1" is the outfit edited; "o2" another saved outfit (t2, b1, s1).
  type Slot = "top" | "bottom" | "shoes" | "layer";
  type Row = { item_id: string; slot: Slot };
  type Outfit = { id: string; saved_at: string | null; name: string | null; is_favorite: boolean; context_type: string; source: string; created_for_date: string };
  const SAVED_AT = "2026-11-10T08:00:00.123456+00:00";
  const before: Row[] = [
    { item_id: "t1", slot: "top" },
    { item_id: "b1", slot: "bottom" },
    { item_id: "s1", slot: "shoes" },
  ];
  const after: Row[] = [
    { item_id: "t3", slot: "top" },
    { item_id: "b1", slot: "bottom" },
    { item_id: "s1", slot: "shoes" },
    { item_id: "l1", slot: "layer" },
  ];
  const edit = { userId: "u1", date: "2026-11-20", garments: after, contextType: "shabbat" as const, name: "  שבת " };

  // `use` under another name: the hooks lint rule reads any `use(...)` inside a named function as a React hook.
  const answer = use;
  function model(opts: { wears?: number; fail?: string | null } = {}) {
    const db = {
      outfits: [
        { id: "o1", saved_at: SAVED_AT, name: "ערב", is_favorite: true, context_type: "weekday", source: "daily", created_for_date: "2026-11-10" },
        { id: "o2", saved_at: "2026-11-12T08:00:00+00:00", name: null, is_favorite: false, context_type: "weekday", source: "manual", created_for_date: "2026-11-12" },
      ] as Outfit[],
      items: [...before.map((r) => ({ outfit_id: "o1", ...r })), ...["t2", "b1", "s1"].map((id, n) => ({ outfit_id: "o2", item_id: id, slot: (["top", "bottom", "shoes"] as const)[n]! }))],
      wears: Array.from({ length: opts.wears ?? 0 }, (_, n) => ({ id: `w${n}`, outfit_id: "o1" })),
      fail: opts.fail ?? null,
      seq: 0,
    };
    const idOf = (c: FakeCall) => c.filters.find((f) => f[0] === "eq" && f[1] === "id")?.[2] as string | undefined;
    answer((c) => {
      const step = `${c.op} ${c.table}`;
      if (db.fail === step) {
        db.fail = null;
        return { error: new Error(`failed: ${step}`) };
      }
      if (c.table === "outfit_items" && c.op === "insert") db.items.push(...(c.payload as (Row & { outfit_id: string })[]));
      if (c.table === "outfit_items" && c.op === "delete") {
        const oid = c.filters.find((f) => f[1] === "outfit_id")![2] as string;
        const gone = c.filters.find((f) => f[0] === "in")![2] as string[];
        db.items = db.items.filter((i) => !(i.outfit_id === oid && gone.includes(i.item_id)));
      }
      if (c.table === "outfits" && c.op === "insert") {
        const id = `n${++db.seq}`;
        db.outfits.push({ id, ...(c.payload as Omit<Outfit, "id">) });
        return { data: { id } };
      }
      if (c.table === "outfits" && c.op === "delete") db.outfits = db.outfits.filter((o) => o.id !== idOf(c));
      if (c.table === "outfits" && c.op === "update") {
        const o = db.outfits.find((x) => x.id === idOf(c));
        if (o) Object.assign(o, c.payload);
        return { data: o ? [{ id: o.id }] : [] };
      }
      if (c.op === "select" && c.table === "outfits") {
        const garments = (id: string) => db.items.filter((i) => i.outfit_id === id).map(({ item_id, slot }) => ({ item_id, slot }));
        if (c.payload === "id,saved_at,outfit_items(item_id)") return { data: db.outfits.filter((o) => o.saved_at !== null).map((o) => ({ id: o.id, saved_at: o.saved_at, outfit_items: garments(o.id) })) };
        const o = db.outfits.find((x) => x.id === idOf(c));
        if (!o) return { data: null };
        if (typeof c.payload === "string" && c.payload.startsWith("saved_at,name,is_favorite")) {
          return { data: { saved_at: o.saved_at, name: o.name, is_favorite: o.is_favorite, outfit_items: garments(o.id), wears: db.wears.filter((w) => w.outfit_id === o.id).map((w) => ({ id: w.id })) } };
        }
        return { data: { ...outfitRow(o.id, o.saved_at), name: o.name, is_favorite: o.is_favorite, context_type: o.context_type } };
      }
      return {};
    });
    return db;
  }
  const setOf = (db: ReturnType<typeof model>, id: string) => db.items.filter((i) => i.outfit_id === id).map((i) => i.item_id).sort();

  it("never worn: changes that row in place (gains inserted, losses deleted, then the row), the id stays", async () => {
    const db = model();
    const result = await updateSavedOutfit("o1", edit);
    expect(result.replacedId).toBeNull();
    expect(result.outfit.id).toBe("o1");
    expect(ops()).toEqual(["select outfits", "select outfits", "insert outfit_items", "delete outfit_items", "update outfits", "select outfits"]);
    expect(fake.calls[4]!.payload).toEqual({ context_type: "shabbat", name: "שבת" });
    expect(setOf(db, "o1")).toEqual(["b1", "l1", "s1", "t3"]);
    expect(db.outfits).toHaveLength(2);
  });

  it("worn: a new saved row carries name, favourite and the exact saved_at; the old row is unsaved and keeps its garments", async () => {
    const db = model({ wears: 1 });
    const result = await updateSavedOutfit("o1", { ...edit, name: "ערב" });
    expect(result.replacedId).toBe("o1");
    expect(ops()).toEqual(["select outfits", "select outfits", "insert outfits", "insert outfit_items", "update outfits", "select outfits"]);
    const copy = db.outfits.find((o) => o.id === result.outfit.id)!;
    expect(copy).toMatchObject({ saved_at: SAVED_AT, name: "ערב", is_favorite: true, context_type: "shabbat", source: "manual", created_for_date: "2026-11-20" });
    expect(fake.calls[2]!.payload).toMatchObject({ user_id: "u1" });
    expect(setOf(db, copy.id)).toEqual(["b1", "l1", "s1", "t3"]);
    expect(db.outfits.find((o) => o.id === "o1")).toMatchObject({ saved_at: null, is_favorite: false });
    expect(setOf(db, "o1")).toEqual(["b1", "s1", "t1"]);
    expect(db.wears).toEqual([{ id: "w0", outfit_id: "o1" }]);
  });

  it("worn, only the name and context changed: the same row", async () => {
    const db = model({ wears: 2 });
    const result = await updateSavedOutfit("o1", { ...edit, garments: [...before].reverse() });
    expect(result.replacedId).toBeNull();
    expect(ops()).toEqual(["select outfits", "select outfits", "update outfits", "select outfits"]);
    expect(db.outfits).toHaveLength(2);
  });

  it("worn, the copy's garments fail: the new row is deleted again and nothing changed", async () => {
    const db = model({ wears: 1, fail: "insert outfit_items" });
    // Not the half-done error: nothing is saved, so the screen may say "not saved".
    await expect(updateSavedOutfit("o1", edit)).rejects.toThrow("failed: insert outfit_items");
    expect(db.outfits.map((o) => [o.id, o.saved_at !== null])).toEqual([
      ["o1", true],
      ["o2", true],
    ]);
  });

  it("worn, unsaving the old row fails: two saved rows; the retry finishes the edit instead of answering 'already saved'", async () => {
    const db = model({ wears: 1, fail: "update outfits" });
    // Typed: the new outfit is saved, the old one still in the collection; the request's error is the cause.
    const err = await updateSavedOutfit("o1", edit).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SavedOutfitError);
    expect(err).toMatchObject({ code: "copy_saved_old_kept", otherId: "n1" });
    expect((err as Error).cause).toMatchObject({ message: "failed: update outfits" });
    expect(db.outfits.filter((o) => o.saved_at !== null).map((o) => o.id)).toEqual(["o1", "o2", "n1"]);
    const from = fake.calls.length;
    const retry = await updateSavedOutfit("o1", { ...edit, contextType: "date", name: "אחר" });
    expect(retry).toMatchObject({ replacedId: "o1", outfit: { id: "n1" } });
    expect(fake.calls.slice(from).filter((c) => c.op === "insert")).toEqual([]);
    expect(db.outfits.filter((o) => o.saved_at !== null).map((o) => o.id)).toEqual(["o2", "n1"]);
    expect(db.outfits.find((o) => o.id === "n1")).toMatchObject({ context_type: "date", name: "אחר", saved_at: SAVED_AT });
  });

  it("in place: a failing step never leaves part of a set, and a retry finishes", async () => {
    for (const fail of ["insert outfit_items", "delete outfit_items", "update outfits"]) {
      const db = model({ fail });
      await expect(updateSavedOutfit("o1", edit)).rejects.toThrow(`failed: ${fail}`);
      const ids = setOf(db, "o1");
      const whole = (set: readonly Row[]) => set.every((g) => ids.includes(g.item_id));
      expect(whole(before) || whole(after), fail).toBe(true);
      await updateSavedOutfit("o1", edit);
      expect(setOf(db, "o1"), fail).toEqual(["b1", "l1", "s1", "t3"]);
    }
  });

  it("refuses the garments of another saved outfit, naming it, worn or not, and writes nothing", async () => {
    for (const wears of [0, 1]) {
      model({ wears });
      const err = await updateSavedOutfit("o1", { ...edit, garments: [{ item_id: "s1", slot: "shoes" }, { item_id: "t2", slot: "top" }, { item_id: "b1", slot: "bottom" }] }).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(SavedOutfitError);
      expect(err).toMatchObject({ code: "same_garments", otherId: "o2" });
      expect(fake.calls.some((c) => c.op !== "select")).toBe(false);
    }
  });

  it("validates before any request, refuses an unsaved or missing row, and rejects in the design preview", async () => {
    use(() => ({}));
    await expect(updateSavedOutfit("o1", { ...edit, garments: after.slice(1) })).rejects.toMatchObject({ code: "invalid_outfit" });
    await expect(updateSavedOutfit("o1", { ...edit, name: "x".repeat(41) })).rejects.toMatchObject({ code: "name_too_long" });
    expect(fake.calls).toEqual([]);
    use(() => ({ data: { saved_at: null, name: null, is_favorite: false, outfit_items: before, wears: [] } }));
    await expect(updateSavedOutfit("o1", edit)).rejects.toMatchObject({ code: "not_saved" });
    use(() => ({ data: null }));
    await expect(updateSavedOutfit("o1", edit)).rejects.toMatchObject({ code: "not_found" });
    state.preview = true;
    use(() => ({}));
    await expect(updateSavedOutfit("o1", edit)).rejects.toThrow();
    expect(fake.calls).toEqual([]);
  });
});
