import { createClient } from "@supabase/supabase-js";
import { CALENDAR_UNAVAILABLE_MESSAGE, CALENDAR_UNAVAILABLE_SHABBAT_MESSAGE, type HebcalDayItem } from "@fit-check/schema/day-context.ts";
import { DEFAULT_CONTEXT_RULES, type DayWeather } from "../_shared/engine.js";
import { outfitToday, type OutfitDeps } from "./outfit.ts";
import type { ToolContext, ToolResult } from "./tools.ts";

/*
 * outfit_today against a REAL supabase-js client whose fetch is a fake PostgREST (tables in memory, filters from the
 * query string), and fake Hebcal / Open-Meteo. The fake refuses any request without `user_id=eq.<caller>`: the
 * service-role client bypasses RLS, so that filter is what keeps the caller to their own rows.
 *
 * Data: the engine's anonymized wardrobe fixture and Hebcal's real answer for Tishrei 5787 (Israel), kept by the app.
 */

type Row = Record<string, unknown>;
const USER = "00000000-0000-4000-8000-000000000001";
const OTHER = "00000000-0000-4000-8000-000000000002";

const wardrobe = JSON.parse(await Deno.readTextFile(new URL("../../../packages/engine/__fixtures__/wardrobe.json", import.meta.url))) as Row[];
const tishrei = JSON.parse(
  await Deno.readTextFile(new URL("../../../apps/mobile/src/data/__fixtures__/window-tishrei-5787.json", import.meta.url)),
) as { items: HebcalDayItem[] };

class FakeDb {
  tables: Record<string, Row[]> = { items: [], pair_weights: [], wears: [], contexts: [], profile: [], outfits: [] };
  failing = new Set<string>();
  requests: string[] = [];

  fetch = (input: Request | URL | string, init?: RequestInit): Promise<Response> => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
    const table = url.pathname.replace("/rest/v1/", "");
    this.requests.push(`${method} ${table}?${url.searchParams.toString()}`);
    if (method !== "GET") return Promise.resolve(json({ message: `the fake serves reads only (${method} ${table})` }, 400));
    if (url.searchParams.get("user_id") !== `eq.${USER}`) return Promise.resolve(json({ message: `no user filter on ${table}` }, 400));
    if (this.failing.has(table)) return Promise.resolve(json({ message: `${table} is down` }, 500));
    let rows = this.tables[table] ?? [];
    for (const [col, raw] of url.searchParams) {
      if (["select", "order", "limit"].includes(col)) continue;
      rows = rows.filter((r) => matches(r[col], raw));
    }
    return Promise.resolve(json(rows, 200));
  };
}

function matches(value: unknown, raw: string): boolean {
  const [op, ...rest] = raw.split(".");
  const arg = rest.join(".");
  if (op === "eq") return String(value) === arg;
  if (op === "gte") return String(value) >= arg;
  if (op === "lte") return String(value) <= arg;
  if (op === "in") return arg.replace(/^\(|\)$/g, "").split(",").includes(String(value));
  if (op === "is") return arg === "null" ? value === null || value === undefined : String(value) === arg;
  if (op === "not" && arg === "is.null") return value !== null && value !== undefined;
  throw new Error(`fake PostgREST: unsupported filter ${raw}`);
}

const json = (body: unknown, status: number) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const WEATHER: DayWeather = { temp_min_c: 18, temp_max_c: 26, rain_probability: 0.1, wind_max_kmh: 10, uv_max: 5, sky: "clear" };

function setup(opts: { observes?: boolean; items?: Row[] } = {}) {
  const fake = new FakeDb();
  fake.tables.items = (opts.items ?? wardrobe).map((r) => ({ ...r, user_id: USER }));
  fake.tables.profile = [{ user_id: USER, observes_shabbat: opts.observes ?? true }];
  const db = createClient("https://x.supabase.co", "service-role", {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: fake.fetch },
  });
  const ctx: ToolContext = { db, userId: USER, supabaseUrl: "https://x.supabase.co" };
  let clock = new Date("2026-10-10T09:00:00Z");
  let calendarDown = false;
  const deps: OutfitDeps = {
    now: () => clock,
    hebcal: () => (calendarDown ? Promise.reject(new Error("timed out")) : Promise.resolve(tishrei.items)),
    weather: () => Promise.resolve(WEATHER),
  };
  return {
    fake,
    ctx,
    deps,
    at: (iso: string) => {
      clock = new Date(iso);
    },
    calendarFails: () => {
      calendarDown = true;
    },
  };
}

type Candidate = { outfit_id: string; score: number; items: Array<{ id: string; slot: string; type: string }> };
type Answer = {
  rules: string;
  day_type: string;
  occasion: { applied: boolean; why: string } | null;
  calendar: { known: boolean };
  warning: { code: string; message: string } | null;
  saved_outfits_counted: number | string;
  shoes_note?: string;
  candidates: Candidate[];
};
const answer = (r: ToolResult): Answer => {
  if (r.isError) throw new Error(`tool failed: ${(r.content[0] as { text: string }).text}`);
  return JSON.parse((r.content[0] as { text: string }).text) as Answer;
};
const assert = (cond: unknown, msg: string) => {
  if (!cond) throw new Error(msg);
};
const occasionRow = (date: string, type = "date"): Row => ({ user_id: USER, date, type, source: "calendar", payload: { label: "evening out" }, created_at: "2026-10-01T00:00:00Z" });
const shabbatTop = new Set<string>(DEFAULT_CONTEXT_RULES.shabbat.top.allow_subcategories);
const byId = new Map(wardrobe.map((r) => [String(r.id), r]));
const materialOf = (id: string) => (byId.get(id)?.tags as { material: string }).material;

Deno.test("Saturday with a date set, observance on: Shabbat candidates before havdalah, the date's after", async () => {
  const s = setup();
  s.fake.tables.contexts.push(occasionRow("2026-10-10"));
  s.at("2026-10-10T09:00:00Z"); // 12:00 in Israel; havdalah 18:51
  const before = answer(await outfitToday({ date: "2026-10-10" }, s.ctx, s.deps));
  assert(before.rules === "shabbat", `before havdalah: ${before.rules}`);
  assert(before.occasion?.applied === false && before.occasion.why.includes("18:51"), "the occasion waits for 18:51");
  assert(before.candidates.length > 0 && before.candidates.length <= 8, `1..8 candidates, got ${before.candidates.length}`);
  for (const c of before.candidates) for (const i of c.items) if (i.slot === "top") assert(shabbatTop.has(i.type), `a ${i.type} on Shabbat`);
  assert(before.warning === null, "no warning with the calendar known");

  s.at("2026-10-10T17:30:00Z"); // 20:30
  const after = answer(await outfitToday({ date: "2026-10-10" }, s.ctx, s.deps));
  assert(after.rules === "date" && after.occasion?.applied === true, `after havdalah: ${after.rules}`);
});

Deno.test("Saturday with a date set, observance off: the date's rules all day", async () => {
  const s = setup({ observes: false });
  s.fake.tables.contexts.push(occasionRow("2026-10-10"));
  s.at("2026-10-10T09:00:00Z");
  const r = answer(await outfitToday({ date: "2026-10-10" }, s.ctx, s.deps));
  assert(r.rules === "date", `got ${r.rules}`);
});

Deno.test("an outfit worn on a date yesterday is not offered for a date again", async () => {
  const s = setup();
  s.fake.tables.contexts.push(occasionRow("2026-10-13"));
  s.at("2026-10-13T09:00:00Z");
  const first = answer(await outfitToday({ date: "2026-10-13" }, s.ctx, s.deps));
  assert(first.rules === "date", `got ${first.rules}`);
  const top = first.candidates[0]!;
  s.fake.tables.wears.push({
    id: "w1",
    user_id: USER,
    worn_on: "2026-10-12",
    feedback: "worn",
    outfit_id: "o1",
    outfits: { context_type: "date", breakdown: null, outfit_items: top.items.map((i) => ({ item_id: i.id })) },
  });
  const second = answer(await outfitToday({ date: "2026-10-13" }, s.ctx, s.deps));
  assert(!second.candidates.some((c) => c.outfit_id === top.outfit_id), "yesterday's date outfit came back");
  // Yesterday the recency penalty would also push it down. Twenty days back, past the 14-day outfit penalty, the date
  // rule (the last three dates, read from the wear's context) still keeps it out.
  const wear = s.fake.tables.wears[0]!;
  wear.worn_on = "2026-09-23";
  const oldDate = answer(await outfitToday({ date: "2026-10-13" }, s.ctx, s.deps));
  assert(!oldDate.candidates.some((c) => c.outfit_id === top.outfit_id), "a date outfit 20 days back came back");
  assert(second.candidates.length > 0, "other candidates remain");
});

Deno.test("Yom Kippur: no leather, suede or unknown shoes; with none left, no shoes and a note", async () => {
  const s = setup();
  s.at("2026-09-21T09:00:00Z");
  const r = answer(await outfitToday({ date: "2026-09-21" }, s.ctx, s.deps));
  assert(r.rules === "yom_kippur", `got ${r.rules}`);
  assert(r.candidates.length > 0, "candidates exist");
  for (const c of r.candidates) {
    for (const i of c.items) if (i.slot === "shoes") assert(!["leather", "suede", "unknown"].includes(materialOf(i.id)), `shoe ${i.id} is ${materialOf(i.id)}`);
  }
  assert(r.shoes_note === undefined, "the wardrobe has a shoe known not to be leather");

  const noSafeShoes = wardrobe.filter((row) => {
    const t = row.tags as { category: string; material: string };
    return t.category !== "shoes" || ["leather", "suede", "unknown"].includes(t.material);
  });
  const t = setup({ items: noSafeShoes });
  t.at("2026-09-21T09:00:00Z");
  const bare = answer(await outfitToday({ date: "2026-09-21" }, t.ctx, t.deps));
  assert(bare.candidates.length > 0, "a look is still offered");
  assert(bare.candidates.every((c) => !c.items.some((i) => i.slot === "shoes")), "no shoe at all");
  assert(typeof bare.shoes_note === "string", "shoes_note says so");
});

Deno.test("a saved outfit valid today ranks above an equal unsaved candidate; an absent list changes nothing", async () => {
  const s = setup();
  s.at("2026-10-14T06:00:00Z"); // Wednesday
  const base = answer(await outfitToday({ date: "2026-10-14" }, s.ctx, s.deps));
  // Two candidates the engine scores the same (scores are bunched); save the lower-ranked one.
  let pair: [number, number] | null = null;
  for (let i = 0; i < base.candidates.length && !pair; i++) {
    for (let j = i + 1; j < base.candidates.length; j++) {
      if (base.candidates[i]!.score === base.candidates[j]!.score) {
        pair = [i, j];
        break;
      }
    }
  }
  assert(pair, "the fixture has two equally scored candidates");
  const [hi, lo] = pair!;
  const savedOne = base.candidates[lo]!;
  const other = base.candidates[hi]!.outfit_id;
  s.fake.tables.outfits.push(
    { user_id: USER, saved_at: "2026-10-01T00:00:00Z", is_favorite: false, outfit_items: savedOne.items.map((i) => ({ item_id: i.id })) },
    // Unsaved rows and other users' rows teach nothing.
    { user_id: USER, saved_at: null, is_favorite: false, outfit_items: base.candidates[0]!.items.map((i) => ({ item_id: i.id })) },
    { user_id: OTHER, saved_at: "2026-10-01T00:00:00Z", is_favorite: true, outfit_items: base.candidates[0]!.items.map((i) => ({ item_id: i.id })) },
  );
  const learned = answer(await outfitToday({ date: "2026-10-14" }, s.ctx, s.deps));
  assert(learned.saved_outfits_counted === 1, `counted ${learned.saved_outfits_counted}`);
  const at = (id: string) => learned.candidates.findIndex((c) => c.outfit_id === id);
  assert(at(savedOne.outfit_id) !== -1 && at(other) !== -1, "both are still offered");
  assert(at(savedOne.outfit_id) < at(other), `the saved outfit (${at(savedOne.outfit_id)}) ranks above its equal (${at(other)})`);

  s.fake.failing.add("outfits");
  const unread = answer(await outfitToday({ date: "2026-10-14" }, s.ctx, s.deps));
  assert(typeof unread.saved_outfits_counted === "string", "the failed read is said");
  assert(JSON.stringify(unread.candidates) === JSON.stringify(base.candidates), "an unread list scores exactly as none");
});

Deno.test("the calendar failing on a Wednesday: weekday rules and the typed warning", async () => {
  const s = setup();
  s.calendarFails();
  s.at("2026-10-14T06:00:00Z");
  const r = answer(await outfitToday({ date: "2026-10-14" }, s.ctx, s.deps));
  assert(r.rules === "weekday" && r.calendar.known === false, `got ${r.rules}`);
  assert(r.warning?.code === "hebrew_calendar_unavailable" && r.warning.message === CALENDAR_UNAVAILABLE_MESSAGE, "the warning");
});

Deno.test("the calendar failing on a Friday: the Friday's own weekday look, a warning that never claims Shabbat", async () => {
  const s = setup();
  s.calendarFails();
  s.at("2026-10-16T06:00:00Z");
  const r = answer(await outfitToday({ date: "2026-10-16" }, s.ctx, s.deps));
  assert(r.rules === "weekday", `got ${r.rules}`);
  assert(r.warning?.message === CALENDAR_UNAVAILABLE_MESSAGE && !/shabbat/i.test(r.warning.message), "holiday-only warning");
});

Deno.test("the calendar failing on a Saturday: Shabbat from the weekday, a date set does not apply", async () => {
  const s = setup();
  s.calendarFails();
  s.fake.tables.contexts.push(occasionRow("2026-10-17"));
  s.at("2026-10-17T19:00:00Z"); // 22:00, after any havdalah, but its time is unknown
  const r = answer(await outfitToday({ date: "2026-10-17" }, s.ctx, s.deps));
  assert(r.rules === "shabbat" && r.occasion?.applied === false, `got ${r.rules}`);
  assert(r.warning?.message === CALENDAR_UNAVAILABLE_SHABBAT_MESSAGE, "the Shabbat variant of the warning");
});

Deno.test("every read is filtered on the caller; bad input is a typed error", async () => {
  const s = setup();
  s.at("2026-10-14T06:00:00Z");
  answer(await outfitToday({}, s.ctx, s.deps));
  assert(s.fake.requests.length >= 6 && s.fake.requests.every((q) => q.includes(`user_id=eq.${USER}`)), s.fake.requests.join("\n"));
  const bad = await outfitToday({ date: "2026-02-30", name: "x" }, s.ctx, s.deps);
  assert(bad.isError === true && JSON.parse((bad.content[0] as { text: string }).text).error.code === "invalid_input", "typed invalid_input");
});
