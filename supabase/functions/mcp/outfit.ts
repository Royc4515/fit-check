import { z } from "zod";
import { ITEM_READ_COLUMNS, WEAR_READ_COLUMNS, WearRowSchema, itemFromRow } from "@fit-check/schema/db.ts";
import type { Item } from "@fit-check/schema/item.ts";
import { StylingRequestSchema, type StylingRequest } from "@fit-check/schema/context.ts";
import { OpenMeteoHourlySchema } from "@fit-check/schema/external.ts";
import {
  adjustRequest,
  DEFAULT_CONTEXT_RULES,
  dueForLaundry,
  feedbackUpdates,
  generateCandidates,
  pairKey,
  RECENT_WEARS_DAYS,
  scoreOutfit,
  summarizeDay,
  type PairWeights,
} from "../_shared/engine.js";
import { planDay } from "@fit-check/schema/day-context.ts";
import { publicUrl, type ToolContext, type ToolResult } from "./tools.ts";
import { loadObservesShabbat, loadOccasionRows } from "./context.ts";
import { israelDate } from "./time.ts";

/**
 * Today's outfit and wear logging over MCP (Roy, 2026-11-17, phase 2).
 *
 * The engine (packages/engine, bundled into _shared/engine.js) builds the candidates exactly as the app does; the
 * paid Sonnet stylist is NOT called. Claude in the chat is already a stylist, so it picks and explains from the
 * candidates itself (Roy: "cut paid AI steps where you can do them yourself").
 *
 * Every query filters on ctx.userId (service-role client, see tools.ts).
 */

/** Tel Aviv area, the app's DEFAULT_LOCATION (apps/mobile/src/data/location.ts). */
const DEFAULT_PLACE = { lat: 32.0809, lon: 34.7806, tz: "Asia/Jerusalem" };
/** Same as the app's FALLBACK_WEATHER: used only when the forecast is unavailable, and said so in the answer. */
const FALLBACK_WEATHER = { temp_min_c: 16, temp_max_c: 24, rain_probability: 0.1 };

type DayType = "weekday" | "shabbat" | "holiday";

const TodayInput = z.object({
  date: z.string().date().optional(),
  day_type: z.enum(["weekday", "shabbat", "holiday"]).optional(),
  lat: z.number().min(-90).max(90).optional(),
  lon: z.number().min(-180).max(180).optional(),
  anchor_item_id: z.string().uuid().optional(),
});

const LogInput = z.object({
  item_ids: z.array(z.string().uuid()).min(2).max(5),
  feedback: z.enum(["worn", "skipped", "disliked"]).default("worn"),
  date: z.string().date().optional(),
  day_type: z.enum(["weekday", "shabbat", "holiday"]).optional(),
});

function daysBefore(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d - days)).toISOString().slice(0, 10);
}

/** Shabbat on Saturday, holiday when Hebcal marks a yom tov, else weekday. A Hebcal failure falls back to the weekday rule. */
async function dayTypeOf(date: string): Promise<DayType> {
  try {
    const res = await fetch(`https://www.hebcal.com/hebcal?v=1&cfg=json&maj=on&i=on&start=${date}&end=${date}`, { signal: AbortSignal.timeout(5000) });
    const body = (await res.json()) as { items?: Array<{ yomtov?: boolean }> };
    if (body.items?.some((i) => i.yomtov === true)) return "holiday";
  } catch {
    // fall through
  }
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay() === 6 ? "shabbat" : "weekday";
}

async function weatherFor(date: string, lat: number, lon: number) {
  try {
    const url =
      `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
      "&hourly=apparent_temperature,precipitation_probability,wind_speed_10m,uv_index,weather_code" +
      `&timezone=${encodeURIComponent(DEFAULT_PLACE.tz)}&forecast_days=3`;
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    return summarizeDay(OpenMeteoHourlySchema.parse(await res.json()), date);
  } catch (error) {
    console.error("weather failed", String(error));
    return null;
  }
}

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

/** Worn outfits of the last RECENT_WEARS_DAYS days (freshness penalty) and today's answered outfits (excluded). */
async function loadHistory(ctx: ToolContext, date: string) {
  const { data, error } = await ctx.db
    .from("wears")
    .select(WEAR_READ_COLUMNS)
    .eq("user_id", ctx.userId)
    .gte("worn_on", daysBefore(date, RECENT_WEARS_DAYS))
    .lte("worn_on", date)
    .order("worn_on", { ascending: false });
  if (error) throw new Error(error.message);
  const recent: StylingRequest["recent_wears"] = [];
  const answeredToday: string[][] = [];
  for (const raw of data ?? []) {
    const row = WearRowSchema.safeParse(raw);
    if (!row.success || !row.data.outfits) continue;
    const ids = row.data.outfits.outfit_items.map((i) => i.item_id);
    if (row.data.feedback === "worn") recent.push({ date: row.data.worn_on, item_ids: ids, context_key: null });
    if (row.data.worn_on === date) answeredToday.push(ids);
  }
  return { recent, answeredToday };
}


export async function outfitToday(args: unknown, ctx: ToolContext): Promise<ToolResult> {
  const input = TodayInput.parse(args ?? {});
  const date = input.date ?? israelDate();
  const [dayType, weather, wardrobe, history, occasionRows, observesShabbat] = await Promise.all([
    input.day_type ? Promise.resolve(input.day_type) : dayTypeOf(date),
    weatherFor(date, input.lat ?? DEFAULT_PLACE.lat, input.lon ?? DEFAULT_PLACE.lon),
    loadWardrobe(ctx),
    loadHistory(ctx, date),
    loadOccasionRows(ctx, date),
    loadObservesShabbat(ctx),
  ]);
  const occasion = occasionRows[0] ?? null;
  const plan = planDay({
    dayType,
    dayTypeForced: input.day_type !== undefined,
    occasion: occasion && occasion.source !== "hebcal" ? { type: occasion.type, label: occasion.label, source: occasion.source } : null,
    observesShabbat,
  });
  // Rule sets come from the engine's DEFAULT_CONTEXT_RULES (holidays share the Shabbat rules, PRD section 7, as in
  // the app); "one step dressier" is the engine's own formality adjustment, not scoring re-implemented here.
  const req = adjustRequest(
    StylingRequestSchema.parse({
      today: date,
      context: DEFAULT_CONTEXT_RULES[plan.rules],
      weather: weather ?? FALLBACK_WEATHER,
      recent_wears: history.recent,
      anchor_item_id: input.anchor_item_id ?? null,
      max_candidates: 8,
    }),
    { temp_steps: 0, formality_steps: plan.formality_steps },
  );
  const same = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.includes(x));
  const byId = new Map(wardrobe.items.map((i) => [i.id, i]));
  const candidates = generateCandidates(wardrobe.items, req, wardrobe.weights)
    .filter((c) => !history.answeredToday.some((ids) => same(ids, c.items.map((i) => i.id))))
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
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(
          {
            date,
            day_type: plan.rules,
            context_used: plan.reason,
            calendar_day_type: dayType,
            weather: weather ?? { ...FALLBACK_WEATHER, note: "forecast unavailable; mild default used" },
            already_answered_today: history.answeredToday.length,
            how_to_answer:
              "Pick ONE candidate as Roy's stylist and explain in Hebrew in one or two sentences why it fits today's weather and day " +
              "(no brand names, colours and garment words in Hebrew). The score is a strong hint, not an order. " +
              "If he wears it, call outfit_log with its item ids.",
            candidates,
          },
          null,
          2
        ),
      },
    ],
  };
}

export async function outfitLog(args: unknown, ctx: ToolContext): Promise<ToolResult> {
  const input = LogInput.parse(args);
  const date = input.date ?? israelDate();
  const dayType = input.day_type ?? (await dayTypeOf(date));
  const { items, weights } = await loadWardrobe(ctx);
  const picked = input.item_ids.map((id) => items.find((i) => i.id === id));
  if (picked.some((i) => !i)) return { content: [{ type: "text", text: "One of the item ids is not in this wardrobe." }], isError: true };
  const outfitItems = picked as Item[];
  const req = StylingRequestSchema.parse({
    today: date,
    context: DEFAULT_CONTEXT_RULES[dayType === "weekday" ? "weekday" : dayType],
    weather: FALLBACK_WEATHER,
    recent_wears: [],
    anchor_item_id: null,
  });
  const { score, ...breakdown } = scoreOutfit(outfitItems, req, weights);

  // Same three writes as the app's recordFeedback (outfits, outfit_items, wears), undone if a later one fails.
  const created = await ctx.db
    .from("outfits")
    .insert({
      user_id: ctx.userId,
      context_type: dayType,
      created_for_date: date,
      score: Math.round(score * 1000) / 1000,
      breakdown: { ...breakdown, adjustment: { temp_steps: 0, formality_steps: 0 } },
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
    const now = new Date().toISOString();
    await ctx.db
      .from("pair_weights")
      .upsert(updates.map((u) => ({ user_id: ctx.userId, item_a: u.a, item_b: u.b, weight: u.weight, updated_at: now })), { onConflict: "user_id,item_a,item_b" });
  }
  let laundry: string[] = [];
  if (input.feedback === "worn") {
    const { data: counts } = await ctx.db.rpc("wear_counts_since_wash", { p_item_ids: input.item_ids });
    const map = new Map(((counts ?? []) as Array<{ item_id: string; wears: number }>).map((r) => [r.item_id, r.wears]));
    const due = dueForLaundry(outfitItems, map);
    if (due.length > 0) {
      await ctx.db.from("items").update({ availability: "laundry" }).in("id", due.map((i) => i.id)).eq("user_id", ctx.userId);
      laundry = due.map((i) => i.name);
    }
  }
  return {
    content: [{ type: "text", text: JSON.stringify({ logged: input.feedback, date, items: outfitItems.map((i) => i.name), moved_to_laundry: laundry }, null, 2) }],
  };
}
