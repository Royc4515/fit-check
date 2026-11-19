import { NO_ADJUSTMENT } from "@fit-check/engine";
import { ItemSchema, type Item } from "@fit-check/schema";
import { describe, expect, it } from "vitest";
import wardrobeJson from "../../../../../packages/engine/__fixtures__/wardrobe.json";
import type { FeedbackHistory, TodayRecord } from "../../data/feedback";
import { contextTypeOf, type DayInput } from "./outfit";
import { defaultAdjustment, occasionInEffect, occasionMayApply, planDays, type DayPlan } from "./plans";

// Not imported from data/feedback: that module talks to Supabase, and this runner never loads React Native.
const EMPTY_HISTORY: FeedbackHistory = { recent: [], today: [], ahead: [], samples: [] };
const wardrobe: Item[] = (wardrobeJson as unknown[]).map((row) => ItemSchema.parse(row));
const byId = new Map(wardrobe.map((i) => [i.id, i]));
const weather = { temp_min_c: 14, temp_max_c: 22, rain_probability: 0 };

const friday: DayInput = { date: "2026-11-20", weather, dayType: "weekday" };
const shabbat: DayInput = { date: "2026-11-21", weather, dayType: "shabbat" };
// Rosh Hashana 5788: the eve is a Friday, day 1 is Shabbat, day 2 a Sunday holiday.
const rhEve: DayInput = { date: "2027-10-01", weather, dayType: "weekday" };
const rh1: DayInput = { date: "2027-10-02", weather, dayType: "shabbat" };
const rh2: DayInput = { date: "2027-10-03", weather, dayType: "holiday" };

const plan = (days: DayInput[], history: FeedbackHistory = EMPTY_HISTORY) =>
  planDays({ items: wardrobe, pairWeights: new Map(), days, history, adjustments: days.map(() => NO_ADJUSTMENT) });
const ids = (p: DayPlan): string[] => (p.plan.kind === "empty" ? [] : p.plan.outfit.items.map((i) => i.id));
const worn = (date: string, itemIds: string[], wearId = `w-${date}`): TodayRecord => ({ wearId, outfitId: `o-${date}`, feedback: "worn", itemIds, date });

describe("planDays", () => {
  it("one day is exactly today's plan", () => {
    const [today] = plan([friday]);
    expect(today!.plan.kind).toBe("suggestion");
    expect(today!.pool).toBe(wardrobe);
    expect(today!.history.recent).toEqual([]);
  });

  it("Shabbat is planned by the Shabbat rules and differs from Friday's look", () => {
    const [fri, sat] = plan([friday, shabbat]);
    expect(sat!.plan.kind).toBe("suggestion");
    const subs = ids(sat!).map((id) => byId.get(id)!.tags.subcategory);
    expect(subs).toContain("button_down");
    expect(subs.some((s) => s === "chinos" || s === "trousers")).toBe(true);
    expect(subs.some((s) => s === "dress_shoes" || s === "boots")).toBe(true);
    expect(ids(sat!)).not.toEqual(ids(fri!));
    // The Shabbat colour preference: the top is white in the real wardrobe (it has white Oxfords).
    const top = ids(sat!).map((id) => byId.get(id)!).find((i) => i.tags.category === "top")!;
    expect(top.tags.color_name).toBe("white");
  });

  it("Shabbat sees Friday's shown look as worn on Friday", () => {
    const [fri, sat] = plan([friday, shabbat]);
    expect(sat!.history.recent[0]).toEqual({ date: friday.date, item_ids: ids(fri!), context_key: null, context_type: "weekday" });
  });

  it("Friday's recorded wear counts once, not twice", () => {
    const fridayLook = ids(plan([friday])[0]!);
    const history: FeedbackHistory = { ...EMPTY_HISTORY, recent: [{ date: friday.date, item_ids: fridayLook, context_key: null }], today: [worn(friday.date, fridayLook)] };
    const [fri, sat] = plan([friday, shabbat], history);
    expect(fri!.plan.kind).toBe("worn");
    expect(sat!.history.recent.filter((w) => w.date === friday.date)).toHaveLength(1);
  });

  it("a garment in the outfit recorded for Shabbat is not offered on Friday, nor as a swap", () => {
    const shabbatLook = ids(plan([friday, shabbat])[1]!);
    const history: FeedbackHistory = { ...EMPTY_HISTORY, ahead: [worn(shabbat.date, shabbatLook)] };
    const [fri, sat] = plan([friday, shabbat], history);
    expect(sat!.plan.kind).toBe("worn");
    expect(ids(sat!)).toEqual(shabbatLook);
    expect(ids(fri!).filter((id) => shabbatLook.includes(id))).toEqual([]);
    expect(fri!.pool.some((i) => shabbatLook.includes(i.id))).toBe(false);
    // Friday's own candidates never carry them either.
    if (fri!.plan.kind === "suggestion") for (const c of fri!.plan.candidates) expect(c.items.some((i) => shabbatLook.includes(i.id))).toBe(false);
  });

  it("but a garment Friday already wore stays in Friday's worn look", () => {
    const shared = ids(plan([friday])[0]!);
    const history: FeedbackHistory = {
      ...EMPTY_HISTORY,
      recent: [{ date: friday.date, item_ids: shared, context_key: null }],
      today: [worn(friday.date, shared)],
      ahead: [worn(shabbat.date, [shared[0]!])],
    };
    expect(ids(plan([friday, shabbat], history)[0]!)).toEqual(shared);
  });

  it("a skipped look of a planned day is not offered again that day only", () => {
    const first = plan([friday, shabbat]);
    const skipped: TodayRecord = { ...worn(shabbat.date, ids(first[1]!)), feedback: "skipped" };
    const [, sat] = plan([friday, shabbat], { ...EMPTY_HISTORY, ahead: [skipped] });
    expect(sat!.plan.kind).toBe("suggestion");
    expect(ids(sat!)).not.toEqual(ids(first[1]!));
  });

  it("Rosh Hashana: two different looks, day 2 planned after day 1", () => {
    const [, d1, d2] = plan([rhEve, rh1, rh2]);
    expect(d1!.plan.kind).toBe("suggestion");
    expect(d2!.plan.kind).toBe("suggestion");
    expect(ids(d1!)).not.toEqual(ids(d2!));
    expect(d2!.history.recent.slice(0, 2).map((w) => w.date)).toEqual([rh1.date, rhEve.date]);
  });

  it("Rosh Hashana: recording day 1 as shown leaves day 2 as it was", () => {
    const [, d1, d2] = plan([rhEve, rh1, rh2]);
    const after = plan([rhEve, rh1, rh2], { ...EMPTY_HISTORY, ahead: [worn(rh1.date, ids(d1!))] });
    expect(after[1]!.plan.kind).toBe("worn");
    expect(ids(after[2]!)).toEqual(ids(d2!));
  });
});

describe("what is on the day (DESIGN.md 4.5)", () => {
  it("an occasion overrides the calendar, Shabbat included, and its rules apply", () => {
    const [, sat] = plan([friday, { ...shabbat, occasion: "interview" }]);
    expect(sat!.plan.req.context.type).toBe("interview");
    const [fri] = plan([{ ...friday, occasion: "date" }]);
    expect(fri!.plan.req.context.type).toBe("date");
  });
  it("an occasion takes no festive step on top", () => {
    expect(defaultAdjustment({ festive: true, occasion: "event" })).toEqual({ temp_steps: 0, formality_steps: 0 });
    expect(defaultAdjustment({ festive: true }).formality_steps).toBe(1);
  });
  it("an earlier day's look is remembered in its own context", () => {
    const [, sat] = plan([{ ...friday, occasion: "date" }, shabbat]);
    expect(sat!.history.recent[0]!.context_type).toBe("date");
  });
  it("a date planned after three date wears does not repeat them", () => {
    const first = plan([{ ...friday, occasion: "date" }])[0]!;
    const blocked = ids(first);
    const history: FeedbackHistory = { ...EMPTY_HISTORY, recent: [{ date: "2026-10-01", item_ids: blocked, context_key: null, context_type: "date" }] };
    expect(ids(plan([{ ...friday, occasion: "date" }], history)[0]!)).not.toEqual(blocked);
  });
});

describe("when an occasion decides the look (DESIGN.md 4.5 item 3, corrected)", () => {
  const today = (dayType: DayInput["dayType"], havdalahToday: string | null, now: string) => ({ tab: "today" as const, dayType, havdalahToday, now });
  it("a weekday: the occasion wins (Friday before candle lighting is a weekday)", () => {
    expect(occasionInEffect("date", today("weekday", null, "10:00"))).toBe("date");
  });
  it("Shabbat before its havdalah: Shabbat's rules, no occasion", () => {
    expect(occasionMayApply(today("shabbat", "17:17", "12:00"))).toBe(false);
    expect(occasionInEffect("date", today("shabbat", "17:17", "17:16"))).toBeUndefined();
  });
  it("Shabbat after its havdalah: the occasion (a date on Saturday night)", () => {
    expect(occasionInEffect("date", today("shabbat", "17:17", "17:17"))).toBe("date");
    expect(occasionInEffect("date", today("shabbat", "17:17", "21:00"))).toBe("date");
  });
  it("the first day of a two-day holiday (no havdalah that day): never", () => {
    expect(occasionInEffect("event", today("holiday", null, "23:00"))).toBeUndefined();
  });
  it("the switch off: Shabbat arrives as a weekday, so the occasion wins", () => {
    expect(occasionInEffect("interview", today("weekday", null, "11:00"))).toBe("interview");
  });
  it("a planned day's tab never uses an occasion, even one stored on its date", () => {
    expect(occasionInEffect("date", { tab: "planned", dayType: "shabbat", havdalahToday: "17:17", now: "21:00" })).toBeUndefined();
  });
  it("a wear on Shabbat before havdalah keeps context_type shabbat", () => {
    const occasion = occasionInEffect("date", today("shabbat", "17:17", "12:00"));
    expect(contextTypeOf({ dayType: "shabbat", occasion })).toBe("shabbat");
    expect(plan([{ ...shabbat, occasion }])[0]!.plan.req.context.type).toBe("shabbat");
  });
});
