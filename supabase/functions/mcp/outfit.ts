import { z } from "zod";
import { ITEM_READ_COLUMNS, WEAR_READ_COLUMNS, WearRowSchema, itemFromRow } from "@fit-check/schema/db.ts";
import type { Item } from "@fit-check/schema/item.ts";
import { CONTEXT_TYPES, StylingRequestSchema, type ContextRules, type StylingRequest } from "@fit-check/schema/context.ts";
import { HebcalItemsSchema, OpenMeteoHourlySchema } from "@fit-check/schema/external.ts";
import {
  adjustRequest,
  DEFAULT_CONTEXT_RULES,
  dueForLaundry,
  feedbackUpdates,
  FESTIVE_FORMALITY_STEPS,
  generateCandidates,
  pairKey,
  RECENT_WEARS_DAYS,
  scoreOutfit,
  summarizeDay,
  withSavedPairs,
  YOM_KIPPUR_RULES,
  type DayWeather,
  type PairWeights,
  type SavedOutfitSignal,
} from "../_shared/engine.js";
import {
  calendarAnswerUsable,
  clockOnDate,
  hebcalDayFacts,
  planDay,
  type CalendarDayType,
  type DayPlan,
  type HebrewDayFacts,
  type RuleSet,
} from "@fit-check/schema/day-context.ts";
import { CHAIN_MAX_DAYS, defaultTab, phoneFreeChain, shabbatTimes, type HebcalItem } from "@fit-check/schema/shabbat-times.ts";
import { publicUrl, type ToolContext, type ToolResult } from "./tools.ts";
import { issues, loadObservesShabbat, loadOccasionRows, typedFail } from "./context.ts";
import { israelDate, israelTime } from "./time.ts";

/**
 * Today's outfit and wear logging over MCP (Roy, 2026-11-17, phase 2; brought level with the app 2026-11-20).
 *
 * The engine (packages/engine, bundled into _shared/engine.js) builds the candidates exactly as the app does; the
 * paid Sonnet stylist is NOT called and no AI call is made here at all (nothing to log to `ai_calls`): Claude in the
 * chat is already a stylist, so it picks and explains from the candidates itself.
 *
 * The day's context follows the SAME rule as the app's Today screen (`planDay` in packages/schema day-context.ts):
 * Shabbat and holidays decide until that date's havdalah for someone who keeps them, an occasion only after it. The
 * engine gets what the app gives it: recent wears with their context (the date no-repeat rule), Yom Kippur's own
 * rules (no leather, suede or `unknown` shoes) and the saved outfits (`withSavedPairs`).
 *
 * Every query filters on ctx.userId: the client is the service role (see tools.ts and _shared/auth.ts for why a
 * user-token client does not work inside the Edge runtime), so the filter is what keeps each user to their own rows.
 */

/** Givat Shmuel area, the app's DEFAULT_LOCATION (apps/mobile/src/data/location.ts); 294981 is its GeoNames id. */
const DEFAULT_PLACE = { lat: 32.078, lon: 34.848, tz: "Asia/Jerusalem", geonameid: 294981 };
/** Same as the app's FALLBACK_WEATHER: used only when the forecast is unavailable, and said so in the answer. */
const FALLBACK_WEATHER = { temp_min_c: 16, temp_max_c: 24, rain_probability: 0.1 };
/**
 * How long the Hebcal request may take. Claude is waiting on the answer; Hebcal answers in well under a second when it
 * answers at all (measured 0.4 s for 60 days, 2026-11-20), and past this the day is planned from the civil calendar
 * with the typed warning, never as if it were an ordinary day.
 */
export const CALENDAR_TIMEOUT_MS = 5000;
/** Days asked of Hebcal: a week, so an answer with no candle lighting is recognisably broken (calendarAnswerUsable). */
const CALENDAR_DAYS = 7;
/** CLAUDE.md: the model never sees the whole wardrobe. */
const MAX_CANDIDATES = 8;

/** Where a day is planned: the default place (GeoNames id) or a point the caller passed. */
export type Place = { lat: number; lon: number; isDefault: boolean };

/** What the handlers reach outside the database: injected so tests run with a fixed clock and fake services. */
export type OutfitDeps = {
  now: () => Date;
  /** Hebcal events for `date` and the six days after it; rejects on any failure, timeout or unusable answer. */
  hebcal: (date: string, place: Place) => Promise<HebcalItem[]>;
  /** The day's weather summary, or null when the forecast is unavailable. Never rejects. */
  weather: (date: string, place: Place) => Promise<DayWeather | null>;
};

function addDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

function weekdayOf(date: string): number {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

async function hebcalLive(date: string, place: Place): Promise<HebcalItem[]> {
  const end = addDays(date, CALENDAR_DAYS - 1);
  // The same request as the app's (data/dayContext.ts startCalendar), Israel schedule (i=on): the server plans in Israel.
  const where = place.isDefault
    ? `geonameid=${DEFAULT_PLACE.geonameid}`
    : `latitude=${place.lat}&longitude=${place.lon}&tzid=${encodeURIComponent(DEFAULT_PLACE.tz)}`;
  const url = `https://www.hebcal.com/hebcal?v=1&cfg=json&maj=on&min=on&i=on&c=on&M=on&${where}&start=${date}&end=${end}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(CALENDAR_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`Hebcal answered ${res.status}`);
  const { items } = HebcalItemsSchema.parse(await res.json());
  // don't touch / an empty 200 is not a calendar: treated as a failure so the warning is given, as in the app.
  if (!calendarAnswerUsable(items, date, end)) throw new Error("Hebcal answered with no candle lighting in the week");
  return items;
}

async function weatherLive(date: string, place: Place): Promise<DayWeather | null> {
  try {
    const url =
      `https://api.open-meteo.com/v1/forecast?latitude=${place.lat}&longitude=${place.lon}` +
      "&hourly=apparent_temperature,precipitation_probability,wind_speed_10m,uv_index,weather_code" +
      `&timezone=${encodeURIComponent(DEFAULT_PLACE.tz)}&forecast_days=3`;
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    return summarizeDay(OpenMeteoHourlySchema.parse(await res.json()), date);
  } catch (error) {
    console.error("weather failed", String(error));
    return null;
  }
}

export const LIVE_DEPS: OutfitDeps = { now: () => new Date(), hebcal: hebcalLive, weather: weatherLive };

const DayTypeInput = z.enum(["weekday", "shabbat", "holiday"]);

/**
 * Israel, roughly (Eilat to the Golan, the coast to the Jordan). The server plans every place in Israel time with
 * Israel's holiday schedule (Hebcal tzid=Asia/Jerusalem, i=on), so a point abroad would get wrong candle times and
 * holiday days; it is refused with a typed error instead of answered wrongly.
 */
const ISRAEL = { latMin: 29.45, latMax: 33.35, lonMin: 34.2, lonMax: 35.95 };
export const OUTSIDE_ISRAEL_MESSAGE =
  "lat/lon must be in Israel: the server plans days in Israel time with Israel's holiday schedule. Leave them out for Givat Shmuel.";

/** lat/lon, optional and together, inside Israel; shared by both tools so they always plan the same place. */
const withPlace = <T extends z.ZodRawShape>(shape: T) =>
  z
    .object({ ...shape, lat: z.number().min(-90).max(90).optional(), lon: z.number().min(-180).max(180).optional() })
    .strict()
    .refine((v) => (v.lat === undefined) === (v.lon === undefined), "lat and lon go together")
    .refine(
      (v) =>
        v.lat === undefined ||
        v.lon === undefined ||
        (v.lat >= ISRAEL.latMin && v.lat <= ISRAEL.latMax && v.lon >= ISRAEL.lonMin && v.lon <= ISRAEL.lonMax),
      OUTSIDE_ISRAEL_MESSAGE,
    );

const TodayInput = withPlace({
  date: z.string().date().optional(),
  day_type: DayTypeInput.optional(),
  anchor_item_id: z.string().uuid().optional(),
});

const LogInput = withPlace({
  item_ids: z.array(z.string().uuid()).min(2).max(5),
  feedback: z.enum(["worn", "skipped", "disliked"]).default("worn"),
  date: z.string().date().optional(),
  day_type: DayTypeInput.optional(),
});

/** The day as both tools plan it: the shared rule over the calendar, the stored occasion and the profile. */
type ResolvedDay = { plan: DayPlan; facts: HebrewDayFacts | null; calendarError: string | null };

/**
 * Plans `date` with the shared rule. The calendar is asked only when no day type was passed; a failure or timeout is
 * not an error of the tool: the plan falls back to the civil calendar and carries its typed warning.
 */
async function resolveDay(ctx: ToolContext, deps: OutfitDeps, date: string, forced: CalendarDayType | null, place: Place): Promise<ResolvedDay> {
  const now = deps.now();
  const calendar: Promise<{ facts: HebrewDayFacts | null; error: string | null }> = forced
    ? Promise.resolve({ facts: null, error: null })
    : deps.hebcal(date, place).then(
        (items) => ({ facts: hebcalDayFacts(items, date), error: null }),
        (error: unknown) => {
          console.error("hebcal failed", String(error));
          return { facts: null, error: error instanceof Error ? error.message : String(error) };
        },
      );
  const [cal, occasionRows, observesShabbat] = await Promise.all([calendar, loadOccasionRows(ctx, date), loadObservesShabbat(ctx)]);
  const occasion = occasionRows[0];
  const plan = planDay({
    weekday: weekdayOf(date),
    calendar: cal.facts,
    observesShabbat,
    // don't touch / `hebcal` rows are the calendar's own record, not an occasion anyone chose.
    occasion: occasion && occasion.source !== "hebcal" ? { type: occasion.type, label: occasion.label, source: occasion.source } : null,
    dayTypeForced: forced,
    now: clockOnDate(date, israelDate(now), israelTime(now)),
  });
  return { plan, facts: cal.facts, calendarError: cal.error };
}

const rulesOf = (set: RuleSet): ContextRules => (set === "yom_kippur" ? YOM_KIPPUR_RULES : DEFAULT_CONTEXT_RULES[set]);

async function loadWardrobe(ctx: ToolContext): Promise<{ items: Item[]; weights: PairWeights }> {
  const [itemsRes, pairsRes] = await Promise.all([
    ctx.db.from("items").select(ITEM_READ_COLUMNS).eq("user_id", ctx.userId),
    ctx.db.from("pair_weights").select("item_a,item_b,weight").eq("user_id", ctx.userId),
  ]);
  if (itemsRes.error) throw new Error(itemsRes.error.message);
  const items: Item[] = [];
  for (const row of itemsRes.data ?? []) {
    try {
      items.push(itemFromRow(row));
    } catch {
      // Same rule as the app: one malformed row must not hide the wardrobe.
    }
  }
  const weights: PairWeights = new Map((pairsRes.data ?? []).map((p) => [pairKey(p.item_a, p.item_b), Number(p.weight)]));
  return { items, weights };
}

const SavedRowSchema = z.object({ is_favorite: z.boolean(), outfit_items: z.array(z.object({ item_id: z.string() })) });

/**
 * The user's saved outfits as the engine learns from them (DESIGN.md "שלב 5.2" item 8), or null when they could not be
 * read. Null and an empty list both leave the scores exactly as without the feature (withSavedPairs), so a failure
 * here costs only the bonus and is said in the answer, never an error of the tool.
 */
async function loadSaved(ctx: ToolContext): Promise<SavedOutfitSignal[] | null> {
  const { data, error } = await ctx.db.from("outfits").select("is_favorite,outfit_items(item_id)").eq("user_id", ctx.userId).not("saved_at", "is", null);
  if (error) {
    console.error("saved outfits read failed", error.message);
    return null;
  }
  const out: SavedOutfitSignal[] = [];
  for (const raw of data ?? []) {
    const row = SavedRowSchema.safeParse(raw);
    if (row.success) out.push({ itemIds: row.data.outfit_items.map((i) => i.item_id), isFavorite: row.data.is_favorite });
  }
  return out;
}

// The app's wear read (data/feedback.ts): the outfit's context comes along, which the date no-repeat rule reads.
const WEAR_COLUMNS = WEAR_READ_COLUMNS.replace("outfits(", "outfits(context_type,");
const ContextOfRow = z.object({ outfits: z.object({ context_type: z.enum(CONTEXT_TYPES) }) });

/** Worn outfits of the last RECENT_WEARS_DAYS days, with their context, and today's answered outfits (excluded). */
async function loadHistory(ctx: ToolContext, date: string) {
  const { data, error } = await ctx.db
    .from("wears")
    .select(WEAR_COLUMNS)
    .eq("user_id", ctx.userId)
    .gte("worn_on", addDays(date, -RECENT_WEARS_DAYS))
    .lte("worn_on", date)
    .order("worn_on", { ascending: false });
  if (error) throw new Error(error.message);
  const recent: StylingRequest["recent_wears"] = [];
  const answeredToday: string[][] = [];
  for (const raw of data ?? []) {
    const row = WearRowSchema.safeParse(raw);
    if (!row.success || !row.data.outfits) continue;
    const ids = row.data.outfits.outfit_items.map((i) => i.item_id);
    const context = ContextOfRow.safeParse(raw);
    if (row.data.feedback === "worn") {
      recent.push({ date: row.data.worn_on, item_ids: ids, context_key: null, context_type: context.success ? context.data.outfits.context_type : undefined });
    }
    if (row.data.worn_on === date) answeredToday.push(ids);
  }
  return { recent, answeredToday };
}


/**
 * Reuses the first Hebcal answer of a call for any later date it covers, so planning the day in force and then that
 * day costs one request, not two (the review of PR #51 measured up to 5 s per request).
 */
function sharedCalendar(deps: OutfitDeps): OutfitDeps {
  let first: { date: string; items: Promise<HebcalItem[]> } | null = null;
  return {
    ...deps,
    hebcal: (date, place) => {
      if (first && date >= first.date && date <= addDays(first.date, CHAIN_MAX_DAYS)) return first.items;
      const items = deps.hebcal(date, place);
      first ??= { date, items };
      return items;
    },
  };
}

/** The day a call without a date is about: Israel's civil date, or the planned day the app has moved to. */
type DayInForce = { date: string; movedFrom: string | null };

/**
 * The day in force, by the app's rule (apps/mobile/src/features/today/dayInForce.ts over the same shared functions):
 * today until three hours before today's candle lighting, or until today's outfit is recorded as worn; from then on the
 * first planned day (Shabbat, the holiday) not recorded as worn yet, or the first one when every one is. Without
 * candles, with the observance switch off, or when the calendar cannot be read, it is today.
 *
 * Failure modes: a failed calendar or wears read gives today (the civil date is never wrong, only early); never throws.
 */
async function dayInForce(ctx: ToolContext, deps: OutfitDeps, place: Place): Promise<DayInForce> {
  const now = deps.now();
  const today = israelDate(now);
  const stay: DayInForce = { date: today, movedFrom: null };
  try {
    if (!(await loadObservesShabbat(ctx))) return stay;
    const items = await deps.hebcal(today, place);
    const chain = phoneFreeChain(items, today);
    if (chain.length === 0) return stay;
    const { data, error } = await ctx.db
      .from("wears")
      .select("worn_on")
      .eq("user_id", ctx.userId)
      .eq("feedback", "worn")
      .gte("worn_on", today)
      .lte("worn_on", chain[chain.length - 1]!.date);
    if (error) throw new Error(error.message);
    const worn = new Set((data ?? []).map((r: { worn_on: unknown }) => String(r.worn_on)));
    const tab = defaultTab({
      now: israelTime(now),
      candles: shabbatTimes(items, today).candles?.time ?? null,
      todayRecorded: worn.has(today),
      recorded: chain.map((d) => worn.has(d.date)),
    });
    const date = chain[tab - 1]?.date ?? today;
    return { date, movedFrom: date === today ? null : today };
  } catch (error) {
    console.error("day in force failed", String(error));
    return stay;
  }
}

/** Said to Claude when a call without a date was answered for the planned day, so it can tell Roy which day it is. */
const MOVED_NOTE =
  "No date was passed and candle lighting is less than three hours away (or today's outfit is already worn), so, as in " +
  "the app, this is for the planned day (Shabbat or the holiday) in `date`. Pass `date` explicitly for today.";

const placeOf = (lat: number | undefined, lon: number | undefined): Place =>
  lat !== undefined && lon !== undefined ? { lat, lon, isDefault: false } : { lat: DEFAULT_PLACE.lat, lon: DEFAULT_PLACE.lon, isDefault: true };

/**
 * outfit_today: up to eight outfit candidates for a date (default: the day in force, see dayInForce), built by the app's engine under the
 * app's rules, for Claude to choose from and explain.
 *
 * Inputs (all optional): date, day_type (overrides the calendar and any occasion), lat/lon (together), anchor_item_id.
 * Returns: the rule set used and why, the stored occasion and whether it applies now, the calendar's facts, `warning`
 * (typed; non-null when the Hebrew calendar could not be read and the user keeps Shabbat and holidays), the weather,
 * how many saved outfits were counted, and the candidates.
 * Failure modes: invalid_input (typed); a database error on the wardrobe or the wears throws and becomes a readable
 * tool error. A failed calendar, forecast or saved-outfit read degrades the answer and says so; it never fails it.
 */
export async function outfitToday(args: unknown, ctx: ToolContext, deps: OutfitDeps = LIVE_DEPS): Promise<ToolResult> {
  const parsed = TodayInput.safeParse(args ?? {});
  if (!parsed.success) return typedFail("invalid_input", `${issues(parsed.error)}. Fix the argument and call again.`);
  const input = parsed.data;
  const place = placeOf(input.lat, input.lon);
  const cal = sharedCalendar(deps);
  // don't touch / only a call with neither date nor day_type follows the app's day in force: a forced day type speaks
  // about today, and an explicit date is taken as given.
  const inForce: DayInForce =
    input.date || input.day_type ? { date: input.date ?? israelDate(deps.now()), movedFrom: null } : await dayInForce(ctx, cal, place);
  const date = inForce.date;
  const [day, weather, wardrobe, history, saved] = await Promise.all([
    resolveDay(ctx, cal, date, input.day_type ?? null, place),
    deps.weather(date, place),
    loadWardrobe(ctx),
    loadHistory(ctx, date),
    loadSaved(ctx),
  ]);
  const { plan } = day;
  const req = adjustRequest(
    StylingRequestSchema.parse({
      today: date,
      context: rulesOf(plan.rules),
      weather: weather ?? FALLBACK_WEATHER,
      recent_wears: history.recent,
      anchor_item_id: input.anchor_item_id ?? null,
      max_candidates: MAX_CANDIDATES,
    }),
    // A holiday for someone who does not keep it starts one "dressier" step up, as the app's defaultAdjustment.
    { temp_steps: 0, formality_steps: plan.festive ? FESTIVE_FORMALITY_STEPS : 0 },
  );
  const same = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((x) => b.includes(x));
  const byId = new Map(wardrobe.items.map((i) => [i.id, i]));
  // don't touch / the saved bonus goes into the weights the engine SCORES with, never into pair_weights (it would be
  // banked as wears); an absent or empty list returns the same weights, so nothing changes without saved outfits.
  const scoring = withSavedPairs(wardrobe.weights, saved ?? undefined);
  const candidates = generateCandidates(wardrobe.items, req, scoring)
    .filter((c) => !history.answeredToday.some((ids) => same(ids, c.items.map((i) => i.id))))
    .slice(0, MAX_CANDIDATES)
    .map((c) => ({
      outfit_id: c.outfit_id,
      score: Math.round(c.score * 100) / 100,
      items: c.items.map((i) => ({
        id: i.id,
        slot: i.slot,
        name: i.name,
        type: i.subcategory,
        color: i.color_name,
        formality: i.formality,
        image_url: publicUrl(ctx, byId.get(i.id)?.cutout_path ?? null),
      })),
    }));
  const noShoes = plan.rules === "yom_kippur" && candidates.length > 0 && candidates.every((c) => !c.items.some((i) => i.slot === "shoes"));
  const answer = {
    date,
    ...(inForce.movedFrom ? { date_note: MOVED_NOTE, today: inForce.movedFrom } : {}),
    rules: plan.rules,
    day_type: plan.dayType,
    context_used: plan.reason,
    occasion: plan.occasion,
    calendar: day.facts
      ? { known: true, yomtov: day.facts.yomtov, yom_kippur: day.facts.yomKippur, havdalah_today: day.facts.havdalahToday }
      : { known: false, ...(day.calendarError ? { error: day.calendarError.slice(0, 200) } : { note: "not asked: a day_type was passed" }) },
    warning: plan.warning,
    weather: weather ?? { ...FALLBACK_WEATHER, note: "forecast unavailable; mild default used" },
    already_answered_today: history.answeredToday.length,
    saved_outfits_counted: saved === null ? "could not be read; candidates scored without the saved-outfit bonus" : saved.length,
    ...(noShoes ? { shoes_note: "No shoe known not to be leather (or suede) is in the wardrobe, so the Yom Kippur look comes without shoes. Say so; never suggest a leather shoe." } : {}),
    how_to_answer:
      (plan.warning ? "FIRST tell Roy, in Hebrew, what `warning` says. " : "") +
      "Pick ONE candidate as Roy's stylist and explain in Hebrew in one or two sentences why it fits today's weather and day " +
      "(no brand names, colours and garment words in Hebrew). The score is a strong hint, not an order. " +
      "If he wears it, call outfit_log with its item ids.",
    candidates,
  };
  return { content: [{ type: "text", text: JSON.stringify(answer, null, 2) }] };
}

/**
 * outfit_log: records an outfit as worn, skipped or disliked for a date, with the app's learning and laundry.
 * The wear is recorded in the context the shared rule gives the date (an occasion in effect, else the day type), so the
 * date no-repeat rule sees it as the app would. Failure modes: invalid_input and unknown_item (typed); a database
 * error throws (and a failed later write undoes the earlier ones).
 */
export async function outfitLog(args: unknown, ctx: ToolContext, deps: OutfitDeps = LIVE_DEPS): Promise<ToolResult> {
  const parsed = LogInput.safeParse(args);
  if (!parsed.success) return typedFail("invalid_input", `${issues(parsed.error)}. Fix the argument and call again.`);
  const input = parsed.data;
  // The caller's place, as outfit_today: both tools must decide the day in force from the same candle lighting.
  const place = placeOf(input.lat, input.lon);
  const cal = sharedCalendar(deps);
  // don't touch / the same day in force as outfit_today and the app's wear button: "I'm wearing it" at 16:00 on a
  // Friday is Shabbat's outfit, so it must be recorded on Shabbat's date, not Friday's.
  const inForce: DayInForce =
    input.date || input.day_type ? { date: input.date ?? israelDate(deps.now()), movedFrom: null } : await dayInForce(ctx, cal, place);
  const date = inForce.date;
  const [{ plan }, { items, weights }, saved] = await Promise.all([
    resolveDay(ctx, cal, date, input.day_type ?? null, place),
    loadWardrobe(ctx),
    loadSaved(ctx),
  ]);
  const outfitItems = input.item_ids.flatMap((id) => items.find((i) => i.id === id) ?? []);
  if (outfitItems.length !== input.item_ids.length) return typedFail("unknown_item", "One of the item ids is not in this wardrobe.");
  const req = StylingRequestSchema.parse({ today: date, context: rulesOf(plan.rules), weather: FALLBACK_WEATHER, recent_wears: [], anchor_item_id: null });
  // The stored score includes the saved bonus, as the app's; the learned updates below use the learned weights only.
  const { score, ...breakdown } = scoreOutfit(outfitItems, req, withSavedPairs(weights, saved ?? undefined));
  const formality_steps = plan.festive ? FESTIVE_FORMALITY_STEPS : 0;

  // Same three writes as the app's recordFeedback (outfits, outfit_items, wears), undone if a later one fails.
  const created = await ctx.db
    .from("outfits")
    .insert({
      user_id: ctx.userId,
      context_type: plan.contextType,
      created_for_date: date,
      score: Math.round(score * 1000) / 1000,
      breakdown: { ...breakdown, adjustment: { temp_steps: 0, formality_steps } },
      source: "daily",
    })
    .select("id")
    .single();
  if (created.error) throw new Error(created.error.message);
  const outfitId = String(created.data.id);
  const slots = outfitItems.map((i) => ({ outfit_id: outfitId, item_id: i.id, slot: i.tags.category }));
  const oi = await ctx.db.from("outfit_items").insert(slots);
  const wear = oi.error ? null : await ctx.db.from("wears").insert({ user_id: ctx.userId, outfit_id: outfitId, worn_on: date, feedback: input.feedback });
  if (oi.error || wear?.error) {
    await ctx.db.from("outfits").delete().eq("id", outfitId).eq("user_id", ctx.userId);
    throw new Error(oi.error?.message ?? wear?.error?.message ?? "write failed");
  }

  // Learning and laundry, as the app does after an answer.
  const updates = feedbackUpdates(input.item_ids, input.feedback, weights);
  if (updates.length > 0) {
    const now = deps.now().toISOString();
    await ctx.db
      .from("pair_weights")
      .upsert(updates.map((u) => ({ user_id: ctx.userId, item_a: u.a, item_b: u.b, weight: u.weight, updated_at: now })), { onConflict: "user_id,item_a,item_b" });
  }
  let laundry: string[] = [];
  if (input.feedback === "worn") {
    const { data: counts } = await ctx.db.rpc("wear_counts_since_wash", { p_item_ids: input.item_ids });
    const CountsSchema = z.array(z.object({ item_id: z.string(), wears: z.number() }));
    const parsedCounts = CountsSchema.safeParse(counts ?? []);
    const map = new Map((parsedCounts.success ? parsedCounts.data : []).map((r) => [r.item_id, r.wears]));
    const due = dueForLaundry(outfitItems, map);
    if (due.length > 0) {
      await ctx.db.from("items").update({ availability: "laundry" }).in("id", due.map((i) => i.id)).eq("user_id", ctx.userId);
      laundry = due.map((i) => i.name);
    }
  }
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify({ logged: input.feedback, date, ...(inForce.movedFrom ? { date_note: MOVED_NOTE, today: inForce.movedFrom } : {}), context: plan.contextType, items: outfitItems.map((i) => i.name), moved_to_laundry: laundry }, null, 2),
      },
    ],
  };
}
