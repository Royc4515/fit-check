import { z } from "zod";
import {
  OCCASION_TYPES,
  OccasionDateSchema,
  OccasionLabelSchema,
  OccasionSourceSchema,
  OccasionTypeSchema,
  occasionDateWindowError,
  type OccasionSource,
  type OccasionType,
} from "@fit-check/schema/day-context.ts";
import { DEFAULT_CONTEXT_RULES } from "../_shared/engine.js";
import type { ToolContext, ToolResult } from "./tools.ts";
import { israelDate } from "./time.ts";

/**
 * The day's occasion context over MCP (Roy, 2026-11-19; PRD 7.1): the user's own AI assistant, which can see the
 * calendar, tells Fit Check what kind of day it is (date, interview, event). The calendar itself never reaches us.
 *
 * Database access: same as every MCP tool (see tools.ts and _shared/auth.ts): the service-role client with an
 * explicit `user_id` filter on EVERY query. A user-JWT client does not work inside the Edge runtime, so RLS is not
 * what protects these rows here; the filter is. A query below without `.eq("user_id", ctx.userId)` is a data leak.
 *
 * Only rows of the three occasion types are ever read, written or deleted here; weekday, shabbat, holiday, reserve
 * and trip rows are never touched. Nothing about a person is accepted or stored: `context_key` stays null and the
 * inputs are strict, so a `name` argument is an error (Roy, 2026-11-19).
 */

const TYPED_ERROR_HINT = "Fix the argument and call again.";

/** A tool error the assistant can read and act on: a stable `code` plus a sentence. */
function typedFail(code: string, message: string, extra: Record<string, unknown> = {}): ToolResult {
  return { content: [{ type: "text", text: JSON.stringify({ error: { code, message, ...extra } }, null, 2) }], isError: true };
}
const ok = (value: unknown): ToolResult => ({ content: [{ type: "text", text: JSON.stringify(value, null, 2) }] });

// `.strict()`: an unknown key (a person's name, context_key) is rejected instead of silently dropped.
const SetInput = z
  .object({
    type: OccasionTypeSchema,
    date: OccasionDateSchema.optional(),
    label: OccasionLabelSchema.optional(),
    source: OccasionSourceSchema.default("calendar"),
  })
  .strict();
const DateInput = z.object({ date: OccasionDateSchema.optional() }).strict();

const RowSchema = z.object({
  type: OccasionTypeSchema,
  source: z.enum(["hebcal", "calendar", "manual"]),
  payload: z.unknown(),
  created_at: z.string(),
});
const PayloadSchema = z.record(z.unknown());

export type OccasionRow = { type: OccasionType; source: OccasionSource | "hebcal"; label?: string; payload: Record<string, unknown>; set_at: string };

const issues = (e: z.ZodError) => e.issues.map((i) => `${i.path.join(".") || "input"}: ${i.message}`).join("; ");

/**
 * The occasion rows of `date` for this user, newest first. Newest wins everywhere (see context_set for why two rows
 * can exist for a moment). Failure: throws with the database message.
 */
export async function loadOccasionRows(ctx: ToolContext, date: string): Promise<OccasionRow[]> {
  const { data, error } = await ctx.db
    .from("contexts")
    .select("type,source,payload,created_at")
    .eq("user_id", ctx.userId)
    .eq("date", date)
    .in("type", [...OCCASION_TYPES])
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  const rows: OccasionRow[] = [];
  for (const raw of data ?? []) {
    const row = RowSchema.safeParse(raw);
    if (!row.success) continue;
    const payload = PayloadSchema.safeParse(row.data.payload);
    const body = payload.success ? payload.data : {};
    const label = typeof body.label === "string" ? body.label : undefined;
    rows.push({ type: row.data.type, source: row.data.source, label, payload: body, set_at: row.data.created_at });
  }
  return rows;
}

/**
 * `profile.observes_shabbat` for this user; a missing row or a null means true (the behaviour before the column).
 * A read failure, including the column not existing yet because the migration has not been applied, also means true
 * and is logged: dropping Shabbat rules for someone who keeps Shabbat is the worse mistake.
 */
export async function loadObservesShabbat(ctx: ToolContext): Promise<boolean> {
  const { data, error } = await ctx.db.from("profile").select("observes_shabbat").eq("user_id", ctx.userId).maybeSingle();
  if (error) {
    console.error("observes_shabbat read failed, assuming true", error.message);
    return true;
  }
  const value = z.object({ observes_shabbat: z.boolean().nullable() }).safeParse(data);
  return value.success ? value.data.observes_shabbat ?? true : true;
}

/** One plain line on what a rule set asks for, built from the engine's own rules so it cannot drift from them. */
export function describeRules(type: OccasionType): string {
  const rules = DEFAULT_CONTEXT_RULES[type];
  const slot = (name: string, r: { allow_subcategories: readonly string[]; deny_subcategories: readonly string[]; deny_patterns: readonly string[] }) => {
    const allow = r.allow_subcategories.length > 0 ? r.allow_subcategories.join(" / ") : "any";
    const deny = [...r.deny_subcategories, ...r.deny_patterns.map((p) => `${p} pattern`)];
    return `${name}: ${allow}${deny.length > 0 ? ` (not ${deny.join(", ")})` : ""}`;
  };
  const [lo, hi] = rules.formality_range;
  return `${slot("top", rules.top)}; ${slot("bottom", rules.bottom)}; ${slot("shoes", rules.shoes)}; formality ${lo}-${hi}`;
}

const shown = (row: OccasionRow) => ({ type: row.type, label: row.label ?? null, source: row.source, set_at: row.set_at });

/**
 * context_set: stores the day's occasion (one per date) and says what it changes.
 * Inputs: type (date | interview | event), date (default today in Israel; 1 day back .. 14 ahead), label, source
 * (default calendar). Failures, all typed: invalid_input, date_out_of_range, manual_context_exists (a calendar write
 * over a hand-set context), write_failed, stored_but_cleanup_failed.
 */
export async function contextSet(args: unknown, ctx: ToolContext): Promise<ToolResult> {
  const parsed = SetInput.safeParse(args ?? {});
  if (!parsed.success) return typedFail("invalid_input", `${issues(parsed.error)}. ${TYPED_ERROR_HINT}`);
  const input = parsed.data;
  const today = israelDate();
  const date = input.date ?? today;
  const windowError = occasionDateWindowError(date, today);
  if (windowError) return typedFail("date_out_of_range", `${windowError} ${TYPED_ERROR_HINT}`);

  const existing = await loadOccasionRows(ctx, date);

  // The assistant must not override what the user chose by hand without asking. Enforced here as well as in the tool
  // description, because the description is only a request. After the user agrees, the assistant calls again with
  // source "manual" (the user told it outright, which is what "manual" means).
  const manual = existing.find((r) => r.source === "manual");
  if (input.source === "calendar" && manual) {
    return typedFail(
      "manual_context_exists",
      `${date} already has a context the user set by hand (${manual.type}${manual.label ? `, "${manual.label}"` : ""}). Ask the user whether to replace it; if they agree, call context_set again with source "manual".`,
      { existing: shown(manual) },
    );
  }

  // Merge into the same-type row's payload so keys other writers keep there survive; the old label goes, because a
  // label left over from a different event would be wrong. context_key is not in the payload below on purpose: an
  // upsert only updates the columns it sends, and nothing about a person is ever written by this tool.
  const sameType = existing.find((r) => r.type === input.type);
  const { label: _oldLabel, ...kept } = sameType?.payload ?? {};
  const payload = input.label ? { ...kept, label: input.label } : kept;
  const setAt = new Date().toISOString();

  // Order matters: write the new row FIRST, then delete the other occasion types.
  // - A failure between the two leaves two rows, never none. Every reader takes the newest (created_at, set above to
  //   now on every write), so the new context is already the one in effect, and a retry finishes the cleanup.
  // - The reverse order would lose the user's context on a failure and leave the day with nothing.
  // The upsert hits the existing unique (user_id, date, type), so the same type twice is one row, updated.
  const up = await ctx.db
    .from("contexts")
    .upsert({ user_id: ctx.userId, date, type: input.type, source: input.source, payload, created_at: setAt }, { onConflict: "user_id,date,type" });
  if (up.error) return typedFail("write_failed", `Could not store the context: ${up.error.message}`);

  const others = OCCASION_TYPES.filter((t) => t !== input.type);
  let removed: string[] = [];
  let cleanupError = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    // Only the other two occasion types: weekday, shabbat, holiday, reserve and trip rows are not in this list.
    const del = await ctx.db.from("contexts").delete().eq("user_id", ctx.userId).eq("date", date).in("type", others).select("type");
    if (!del.error) {
      removed = (del.data ?? []).map((r: { type: string }) => r.type);
      cleanupError = "";
      break;
    }
    cleanupError = del.error.message;
  }
  if (cleanupError) {
    return typedFail(
      "stored_but_cleanup_failed",
      `The ${input.type} context for ${date} is stored and is the one in effect, but removing the previous context failed (${cleanupError}). Call context_set again with the same arguments to finish.`,
    );
  }

  return ok({
    stored: { date, type: input.type, label: input.label ?? null, source: input.source, set_at: setAt },
    replaced: removed,
    effect: `Outfit suggestions for ${date} now follow the ${input.type} rules instead of the calendar's day type. ${describeRules(input.type)}.`,
  });
}

/**
 * context_get: the occasion context of a date (default today) or "none", plus whether the profile says the user
 * keeps Shabbat and holidays. Failures: invalid_input; database errors throw and become a readable tool error.
 */
export async function contextGet(args: unknown, ctx: ToolContext): Promise<ToolResult> {
  const parsed = DateInput.safeParse(args ?? {});
  if (!parsed.success) return typedFail("invalid_input", `${issues(parsed.error)}. ${TYPED_ERROR_HINT}`);
  const date = parsed.data.date ?? israelDate();
  const [rows, observes] = await Promise.all([loadOccasionRows(ctx, date), loadObservesShabbat(ctx)]);
  const current = rows[0];
  return ok({
    date,
    context: current ? shown(current) : "none",
    observes_shabbat: observes,
    ...(rows.length > 1 ? { note: `A second occasion row exists for this date (${rows.slice(1).map((r) => r.type).join(", ")}); the newest one is in effect. context_set with the same type cleans it up.` } : {}),
  });
}

/**
 * context_clear: removes the occasion context of a date (default today). Quiet success when there is none.
 * Same date window as context_set: an old row can matter to the app's history. Failures: invalid_input,
 * date_out_of_range, clear_failed.
 */
export async function contextClear(args: unknown, ctx: ToolContext): Promise<ToolResult> {
  const parsed = DateInput.safeParse(args ?? {});
  if (!parsed.success) return typedFail("invalid_input", `${issues(parsed.error)}. ${TYPED_ERROR_HINT}`);
  const today = israelDate();
  const date = parsed.data.date ?? today;
  const windowError = occasionDateWindowError(date, today);
  if (windowError) return typedFail("date_out_of_range", `${windowError} ${TYPED_ERROR_HINT}`);
  const del = await ctx.db.from("contexts").delete().eq("user_id", ctx.userId).eq("date", date).in("type", [...OCCASION_TYPES]).select("type,source");
  if (del.error) return typedFail("clear_failed", `Could not clear the context: ${del.error.message}`);
  const removed = (del.data ?? []) as Array<{ type: string; source: string }>;
  if (removed.length === 0) return ok({ date, cleared: [], note: "No occasion context was set for this date; nothing to clear." });
  return ok({
    date,
    cleared: removed,
    ...(removed.some((r) => r.source === "manual") ? { note: "The removed context had been set by hand; tell the user." } : {}),
    effect: `Outfit suggestions for ${date} follow the calendar's day type again.`,
  });
}
