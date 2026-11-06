import { z } from "zod";
import { SUBCATEGORIES, PATTERNS } from "./item-tags";

export const CONTEXT_TYPES = [
  "weekday",
  "shabbat",
  "holiday",
  "reserve",
  "date",
  "interview",
  "event",
  "trip",
] as const;

export const CONTEXT_SOURCES = ["hebcal", "calendar", "manual"] as const;

/**
 * Hard rules for one context (PRD section 7). Everything here is a filter the
 * engine applies BEFORE scoring; the LLM never gets to argue with it.
 * `allow_*` lists are whitelists: empty means "no restriction on this slot".
 */
export const SlotRuleSchema = z.object({
  allow_subcategories: z.array(z.enum(SUBCATEGORIES)).default([]),
  deny_subcategories: z.array(z.enum(SUBCATEGORIES)).default([]),
  deny_patterns: z.array(z.enum(PATTERNS)).default([]),
  min_formality: z.number().int().min(1).max(10).optional(),
});

export const ContextRulesSchema = z.object({
  type: z.enum(CONTEXT_TYPES),
  // Inclusive target band for the whole outfit; items outside it are filtered.
  formality_range: z.tuple([z.number().int().min(1).max(10), z.number().int().min(1).max(10)]),
  top: SlotRuleSchema.default({}),
  bottom: SlotRuleSchema.default({}),
  shoes: SlotRuleSchema.default({}),
  // Some contexts produce a packing list instead of an outfit (reserve, trip).
  styling: z.enum(["outfit", "packing_list", "none"]).default("outfit"),
  // "date": never repeat a full outfit with the same person. Free-text key.
  no_repeat_with_key: z.boolean().default(false),
});

export type ContextRules = z.infer<typeof ContextRulesSchema>;
export type ContextType = (typeof CONTEXT_TYPES)[number];
export type SlotRule = z.infer<typeof SlotRuleSchema>;

/** Weather the engine receives. Always comes from the caller; the engine never fetches. */
export const WeatherSchema = z.object({
  temp_min_c: z.number(),
  temp_max_c: z.number(),
  rain_probability: z.number().min(0).max(1),
});

export type Weather = z.infer<typeof WeatherSchema>;

/**
 * The full request the engine answers. `today` is an ISO date string so the engine
 * stays pure; `recent_wears` is what the caller already pulled from the DB.
 */
export const StylingRequestSchema = z.object({
  today: z.string().date(),
  context: ContextRulesSchema,
  weather: WeatherSchema,
  /** item ids worn per day, most recent first; used for recency penalties and no-repeat. */
  recent_wears: z.array(
    z.object({ date: z.string().date(), item_ids: z.array(z.string()), context_key: z.string().nullable() })
  ),
  /** Optional anchor the user picked ("build around this shirt"). */
  anchor_item_id: z.string().nullable().default(null),
  /** Caller-supplied; defaults live in engine config but the caller may override. */
  max_candidates: z.number().int().min(1).max(8).default(6),
});

export type StylingRequest = z.infer<typeof StylingRequestSchema>;
