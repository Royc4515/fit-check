import type { Item, ItemTags, Slot, Subcategory } from "@fit-check/schema";
import { SUBCATEGORY_TO_CATEGORY } from "@fit-check/schema";
import { afterEach, describe, expect, it, vi } from "vitest";

// insights.ts reads the network, the device's storage and the saved location; the pure parts under test reach none of
// them, but importing the file loads them, so they are replaced with inert stand-ins (the node runner has no
// react-native). `resolveLocation` is the one a test steers.
const resolveLocation = vi.fn<() => Promise<{ tz: string }>>();
vi.mock("../lib/supabase", () => ({ supabase: {} }));
vi.mock("./location", () => ({ resolveLocation: () => resolveLocation() }));
vi.mock("./preview", () => ({ isPreview: () => false, getSnapshot: () => Promise.reject(new Error("no preview")), PreviewReadOnlyError: class extends Error {} }));
vi.mock("./kv", () => ({ cacheGet: async () => null, cacheSet: async () => undefined }));

const { capLevel, monthStartUtc, summarizeSpend, summarizeWears, wearsToday, windowStart, wornFromRows, WEAR_WINDOW_DAYS } = await import("./insights");
type WornOutfit = import("./insights").WornOutfit;

afterEach(() => vi.restoreAllMocks());

let seq = 0;
function item(name: string, sub: Subcategory = "tshirt"): Item {
  seq += 1;
  const tags: ItemTags = {
    category: SUBCATEGORY_TO_CATEGORY[sub],
    subcategory: sub,
    color_name: "white",
    color_hex: "#F4F1EA",
    secondary_color_hex: null,
    pattern: "solid",
    material: "cotton",
    sleeve: "short",
    fit: "regular",
    seasons: ["summer"],
    formality: 3,
    temp_min_c: 10,
    temp_max_c: 35,
    modesty_flags: [],
    style_tags: [],
  };
  return { id: `it${seq}`, name, brand: null, tags, status: "active", availability: "home", source: "photo", price: null, currency: null, purchased_at: null, cutout_path: null, notes: null };
}
const wear = (id: string, date: string, ...items: (Item | { id: string })[]): WornOutfit => ({
  wearId: id,
  date,
  pieces: items.map((i) => ({ itemId: i.id, slot: null as Slot | null })),
});
const TODAY = "2026-11-19";

describe("wearsToday: the date in the saved location's time zone", () => {
  // 22:30 UTC on the 19th: already the 20th in Israel and New Zealand, still the 19th in New York.
  const now = new Date("2026-11-19T22:30:00Z");
  it("is the location's date, not the device's or UTC's", async () => {
    resolveLocation.mockResolvedValue({ tz: "Asia/Jerusalem" });
    expect(await wearsToday(now)).toBe("2026-11-20");
    resolveLocation.mockResolvedValue({ tz: "America/New_York" });
    expect(await wearsToday(now)).toBe("2026-11-19");
    resolveLocation.mockResolvedValue({ tz: "Pacific/Auckland" });
    expect(await wearsToday(now)).toBe("2026-11-20");
  });

  it("follows the zone across the new year", async () => {
    resolveLocation.mockResolvedValue({ tz: "Asia/Jerusalem" });
    expect(await wearsToday(new Date("2026-12-31T22:30:00Z"))).toBe("2027-01-01");
    resolveLocation.mockResolvedValue({ tz: "America/Los_Angeles" });
    expect(await wearsToday(new Date("2027-01-01T05:00:00Z"))).toBe("2026-12-31");
  });

  it("is a zero-padded yyyy-mm-dd, which is what the wears table compares", async () => {
    resolveLocation.mockResolvedValue({ tz: "UTC" });
    expect(await wearsToday(new Date("2026-03-05T00:00:00Z"))).toBe("2026-03-05");
  });
});

describe("windowStart", () => {
  it("is 29 days before today: the window is 30 days with today included", () => {
    expect(WEAR_WINDOW_DAYS).toBe(30);
    expect(windowStart(TODAY)).toBe("2026-10-21");
  });
  it("crosses month and year boundaries, and a leap day", () => {
    expect(windowStart("2026-03-01")).toBe("2026-01-31");
    expect(windowStart("2027-01-10")).toBe("2026-12-12");
    expect(windowStart("2028-03-15")).toBe("2028-02-15");
  });
  it("a one-day window is today", () => {
    expect(windowStart(TODAY, 1)).toBe(TODAY);
  });
});

describe("wornFromRows", () => {
  const row = (over: Record<string, unknown> = {}) => ({
    id: "w1",
    worn_on: "2026-11-18",
    feedback: "worn",
    outfits: { outfit_items: [{ item_id: "a", slot: "top" }, { item_id: "b" }] },
    ...over,
  });
  const from = windowStart(TODAY);

  it("reads a row with and without the slot (the live query and the preview snapshot)", () => {
    expect(wornFromRows([row()], from, TODAY)).toEqual([
      { wearId: "w1", date: "2026-11-18", pieces: [{ itemId: "a", slot: "top" }, { itemId: "b", slot: null }] },
    ]);
  });

  it("drops what is not a wear: another feedback, no outfit, an outfit with no garments", () => {
    expect(wornFromRows([row({ feedback: "skipped" }), row({ feedback: "disliked" })], from, TODAY)).toEqual([]);
    expect(wornFromRows([row({ outfits: null })], from, TODAY)).toEqual([]);
    expect(wornFromRows([row({ outfits: { outfit_items: [] } })], from, TODAY)).toEqual([]);
  });

  it("keeps both ends of the window and drops the days outside it (the snapshot is cut in UTC)", () => {
    const got = wornFromRows([row({ id: "a", worn_on: from }), row({ id: "b", worn_on: TODAY }), row({ id: "c", worn_on: "2026-10-20" }), row({ id: "d", worn_on: "2026-11-20" })], from, TODAY);
    expect(got.map((w) => w.wearId)).toEqual(["a", "b"]);
  });

  it("skips a malformed row and logs it, without losing the others", () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const got = wornFromRows([null, "x", { id: 5 }, row({ worn_on: "18/11/2026" }), row({ id: "ok" })], from, TODAY);
    expect(got.map((w) => w.wearId)).toEqual(["ok"]);
    expect(log).toHaveBeenCalledTimes(4);
  });

  it("an empty list is empty", () => {
    expect(wornFromRows([], from, TODAY)).toEqual([]);
  });
});

describe("summarizeWears", () => {
  const tee = item("White tee");
  const chinos = item("Chinos", "chinos");
  const shoes = item("Sneakers", "sneakers");
  const belt = item("Belt", "belt");
  const wardrobe = [tee, chinos, shoes, belt];

  it("nothing worn: zeros, no most-worn, a full empty strip", () => {
    const s = summarizeWears([], wardrobe, TODAY);
    expect(s).toMatchObject({ daysWorn: 0, distinctItems: 0, mostWorn: null, outfits: [] });
    expect(s.days).toHaveLength(30);
    expect(s.days.every((d) => !d.worn)).toBe(true);
  });

  it("the strip runs oldest first and ends on today, flagging the days with a wear", () => {
    const s = summarizeWears([wear("a", TODAY, tee), wear("b", "2026-10-21", tee), wear("c", "2026-11-01", tee)], wardrobe, TODAY);
    expect(s.days[0]).toEqual({ date: "2026-10-21", worn: true });
    expect(s.days[29]).toEqual({ date: TODAY, worn: true });
    expect(s.days.filter((d) => d.worn).map((d) => d.date)).toEqual(["2026-10-21", "2026-11-01", TODAY]);
    expect(s.days.map((d) => d.date)).toEqual([...s.days.map((d) => d.date)].sort());
  });

  it("counts days, not wears: two outfits on one day are one day", () => {
    const s = summarizeWears([wear("a", TODAY, tee), wear("b", TODAY, chinos)], wardrobe, TODAY);
    expect(s.daysWorn).toBe(1);
    expect(s.outfits).toHaveLength(2);
  });

  it("ignores wears outside the 30-day window, on either side", () => {
    const s = summarizeWears([wear("old", "2026-10-20", tee), wear("future", "2026-11-20", tee), wear("in", "2026-10-21", chinos)], wardrobe, TODAY);
    expect(s.daysWorn).toBe(1);
    expect(s.distinctItems).toBe(1);
    expect(s.mostWorn?.item.id).toBe(chinos.id);
    expect(s.outfits.map((o) => o.wearId)).toEqual(["in"]);
  });

  it("most worn is the highest count", () => {
    const s = summarizeWears([wear("a", "2026-11-10", tee, chinos), wear("b", "2026-11-11", tee), wear("c", "2026-11-12", shoes)], wardrobe, TODAY);
    expect(s.mostWorn).toEqual({ item: tee, count: 2 });
    expect(s.distinctItems).toBe(3);
  });

  it("a tie goes to the one worn most recently, then to the name, whatever the input order", () => {
    const recent = [wear("a", "2026-11-10", tee), wear("b", "2026-11-12", chinos)];
    expect(summarizeWears(recent, wardrobe, TODAY).mostWorn?.item.id).toBe(chinos.id);
    expect(summarizeWears([...recent].reverse(), wardrobe, TODAY).mostWorn?.item.id).toBe(chinos.id);
    const same = [wear("a", "2026-11-10", tee), wear("b", "2026-11-10", chinos)];
    // "Chinos" sorts before "White tee".
    expect(summarizeWears(same, wardrobe, TODAY).mostWorn?.item.id).toBe(chinos.id);
    expect(summarizeWears([...same].reverse(), [...wardrobe].reverse(), TODAY).mostWorn?.item.id).toBe(chinos.id);
  });

  it("a garment the wardrobe no longer knows is never the most worn, but still counts as a distinct garment", () => {
    const ghost = { id: "deleted" };
    const s = summarizeWears([wear("a", "2026-11-10", ghost), wear("b", "2026-11-11", ghost), wear("c", "2026-11-12", tee)], wardrobe, TODAY);
    expect(s.mostWorn).toEqual({ item: tee, count: 1 });
    expect(s.distinctItems).toBe(2);
    // The outfit of only the ghost has nothing to draw, but is still listed (the row shows its date).
    expect(s.outfits[0]).toMatchObject({ wearId: "a", items: [], pieces: [] });
  });

  it("an archived garment still draws in its old outfit", () => {
    const archived = { ...tee, status: "archived" as const };
    const s = summarizeWears([wear("a", TODAY, archived)], [archived], TODAY);
    expect(s.outfits[0]?.items).toEqual([archived]);
  });

  it("places pieces by the row's slot, else by the engine's; a taken slot and an accessory stay in the list only", () => {
    const tee2 = item("Second tee");
    const outfit: WornOutfit = {
      wearId: "x",
      date: TODAY,
      pieces: [
        { itemId: tee.id, slot: null },
        { itemId: tee2.id, slot: null },
        { itemId: belt.id, slot: null },
        { itemId: chinos.id, slot: "bottom" },
        { itemId: shoes.id, slot: null },
      ],
    };
    const s = summarizeWears([outfit], [...wardrobe, tee2], TODAY);
    expect(s.outfits[0]?.pieces.map((p) => [p.slot, p.item.id])).toEqual([
      ["top", tee.id],
      ["bottom", chinos.id],
      ["shoes", shoes.id],
    ]);
    expect(s.outfits[0]?.items.map((i) => i.id)).toEqual([tee.id, tee2.id, belt.id, chinos.id, shoes.id]);
  });

  it("keeps the newest-first order it is given", () => {
    const s = summarizeWears([wear("new", "2026-11-18", tee), wear("old", "2026-11-02", tee)], wardrobe, TODAY);
    expect(s.outfits.map((o) => o.wearId)).toEqual(["new", "old"]);
  });

  it("a shorter window shortens the strip and the count window", () => {
    const s = summarizeWears([wear("a", "2026-11-10", tee), wear("b", TODAY, tee)], wardrobe, TODAY, 7);
    expect(s.days).toHaveLength(7);
    expect(s.daysWorn).toBe(1);
  });
});

describe("spend", () => {
  it("monthStartUtc is the 1st, 00:00 UTC, whatever the time of day", () => {
    expect(monthStartUtc(new Date("2026-11-19T22:30:00Z"))).toBe("2026-11-01T00:00:00.000Z");
    expect(monthStartUtc(new Date("2026-12-31T23:59:59Z"))).toBe("2026-12-01T00:00:00.000Z");
    expect(monthStartUtc(new Date("2027-01-01T00:00:00Z"))).toBe("2027-01-01T00:00:00.000Z");
  });

  it("sums, counts Google apart, and treats a missing or invalid cost as zero", () => {
    const s = summarizeSpend([
      { provider: "google", task: "separate", cost_usd: 0.5 },
      { provider: "anthropic", task: "tag", cost_usd: 0.25 },
      { provider: "google", task: "separate", cost_usd: null },
      { provider: "google", task: "redraw", cost_usd: Number.NaN },
    ]);
    expect(s.totalUsd).toBeCloseTo(0.75);
    expect(s.googleUsd).toBeCloseTo(0.5);
    expect(s.byTask).toEqual([
      { task: "separate", calls: 2, usd: 0.5 },
      { task: "tag", calls: 1, usd: 0.25 },
      { task: "redraw", calls: 1, usd: 0 },
    ]);
  });

  it("no rows is zero", () => {
    expect(summarizeSpend([])).toEqual({ totalUsd: 0, googleUsd: 0, capUsd: 8, byTask: [] });
  });

  it("orders tasks by cost, then calls, then name", () => {
    const rows = [
      { provider: "x", task: "b", cost_usd: 1 },
      { provider: "x", task: "a", cost_usd: 1 },
      { provider: "x", task: "c", cost_usd: 1 },
      { provider: "x", task: "c", cost_usd: 0 },
    ];
    expect(summarizeSpend(rows).byTask.map((t) => t.task)).toEqual(["c", "a", "b"]);
  });

  it("capLevel: ok under 80%, near from 80%, over at the cap", () => {
    expect(capLevel(0, 8)).toBe("ok");
    expect(capLevel(6.39, 8)).toBe("ok");
    expect(capLevel(6.4, 8)).toBe("near");
    expect(capLevel(7.99, 8)).toBe("near");
    expect(capLevel(8, 8)).toBe("over");
    expect(capLevel(20, 8)).toBe("over");
  });
});
