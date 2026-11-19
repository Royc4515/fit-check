import { describe, expect, it } from "vitest";
import { ItemSchema, StylingRequestSchema, type ContextType, type Item, type StylingRequest } from "@fit-check/schema";
import wardrobeJson from "../__fixtures__/wardrobe.json";
import { DEFAULT_CONTEXT_RULES, NO_REPEAT_LAST_WEARS } from "./config";
import { generateCandidates, noRepeatOutfits } from "./candidates";

const wardrobe: Item[] = (wardrobeJson as unknown[]).map((row) => ItemSchema.parse(row));
const WEATHER = { temp_min_c: 22, temp_max_c: 31, rain_probability: 0 };
type Wear = StylingRequest["recent_wears"][number];
const wear = (date: string, ids: string, context_type?: ContextType): Wear => ({ date, item_ids: ids.split("+"), context_key: null, context_type });
const request = (type: ContextType, recent_wears: Wear[]) =>
  StylingRequestSchema.parse({ today: "2026-11-20", context: DEFAULT_CONTEXT_RULES[type], weather: WEATHER, recent_wears, anchor_item_id: null, max_candidates: 8 });
const ids = (type: ContextType, wears: Wear[], items: Item[] = wardrobe) => generateCandidates(items, request(type, wears), new Map()).map((c) => c.outfit_id);

describe("a date does not repeat an outfit from the last three dates", () => {
  const fresh = ids("date", []);
  // Older dates, far enough back that the 14-day recency penalty no longer applies: only the no-repeat rule acts.
  const old = (i: number) => `2026-10-0${i + 1}`;

  it("N is three, in config", () => expect(NO_REPEAT_LAST_WEARS).toBe(3));

  it("each of the last three date outfits is gone, whatever their dates", () => {
    const worn = fresh.slice(0, 3).map((id, i) => wear(old(i), id, "date"));
    const out = ids("date", worn);
    for (const id of fresh.slice(0, 3)) expect(out).not.toContain(id);
    expect(out.length).toBeGreaterThan(0);
  });

  // Any wear also moves the pre-ranking (itemPrior reads how recently each piece was worn), so each case compares the
  // same history with and without the context: the difference is the no-repeat rule alone.
  const asOther = (ws: Wear[]) => ws.map((w) => ({ ...w, context_type: "weekday" as const }));

  it("the fourth date back no longer counts", () => {
    const three = fresh.slice(1, 4).map((id, i) => wear(old(i), id, "date"));
    const history = [...three, wear("2026-09-01", fresh[0]!, "date")];
    expect(noRepeatOutfits(request("date", history)).has(fresh[0]!)).toBe(false);
    expect(ids("date", history)).toEqual(ids("date", [...three, ...asOther([wear("2026-09-01", fresh[0]!)])]));
  });

  // A wardrobe of only the pieces of the first four date outfits: small enough that the pre-ranking keeps every piece,
  // so an old wear changes nothing but what the rule removes.
  const inFresh = new Set(fresh.slice(0, 4).flatMap((id) => id.split("+")));
  const small = wardrobe.filter((i) => inFresh.has(i.id));

  it("the same outfit worn on a weekday does not block a date, and a date does not block a weekday", () => {
    expect(noRepeatOutfits(request("date", [wear("2026-10-01", fresh[0]!, "weekday")])).size).toBe(0);
    expect(ids("date", [wear("2026-10-01", fresh[0]!, "weekday")], small)).toContain(fresh[0]);
    const weekdayFirst = ids("weekday", [])[0]!;
    const h = [wear("2026-10-01", weekdayFirst, "date")];
    expect(ids("weekday", h)).toEqual(ids("weekday", asOther(h)));
  });

  it("a wear dated after today does not count", () => {
    expect(ids("date", [wear("2026-11-21", fresh[0]!, "date")])[0]).toBe(fresh[0]);
  });

  it("only a complete outfit is blocked, not one that shares some pieces", () => {
    const partial = fresh[0]!.split("+").slice(0, 2).join("+");
    const h = [wear("2026-10-01", partial, "date")];
    expect(ids("date", h)).toEqual(ids("date", asOther(h)));
  });

  it("with the rule, the blocked outfit is gone where the same history without it keeps it", () => {
    const h = [wear("2026-10-01", fresh[0]!, "date")];
    expect(ids("date", asOther(h), small)).toContain(fresh[0]);
    expect(ids("date", h, small)).not.toContain(fresh[0]);
  });

  it("the last three are chosen by date, whatever order the wears come in", () => {
    const four = fresh.slice(0, 4).map((id, i) => wear(`2026-10-1${i}`, id, "date"));
    // Oldest is fresh[0] (2026-10-10); the newest three are fresh[1..3].
    const expected = new Set(fresh.slice(1, 4));
    for (const order of [[0, 1, 2, 3], [3, 2, 1, 0], [2, 0, 3, 1], [1, 3, 0, 2]]) {
      expect(noRepeatOutfits(request("date", order.map((i) => four[i]!)))).toEqual(expected);
    }
  });

  it("an outfit that is the only one the wardrobe can make is not offered for a date once it is blocked", () => {
    // One top, one bottom, one shoe (warm day: no layer): exactly one possible outfit.
    const only = fresh[0]!.split("+");
    const one = wardrobe.filter((i) => only.includes(i.id));
    expect(ids("date", [], one)).toEqual([fresh[0]]);
    expect(ids("date", [wear("2026-10-01", fresh[0]!, "date")], one)).toEqual([]);
  });

  it("contexts without the rule ignore it", () => {
    expect(noRepeatOutfits(request("interview", [wear("2026-10-01", fresh[0]!, "interview")]))).toEqual(new Set());
  });
});
