import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import {
  COLOR_NAMES,
  FITS,
  ItemTagsSchema,
  MATERIALS,
  MODESTY_FLAGS,
  PATTERNS,
  SEASONS,
  SLEEVES,
  STYLE_TAGS,
  SUBCATEGORIES,
  SUBCATEGORY_TO_CATEGORY,
  type ItemTags,
} from "@fit-check/schema/item-tags.ts";
import { sniffImageType } from "../_shared/media.ts";
import { GARMENT_BUCKET, garmentStore } from "../_shared/objects.ts";
import { contextClear, contextGet, contextSet } from "./context.ts";
import { outfitLog, outfitToday } from "./outfit.ts";
import { intakeDismiss, intakePending, itemCreate, itemRecrop, itemRecut, itemRedraw } from "./photos.ts";
import { REDRAW_DETAIL_IDS, REDRAW_FIX_IDS } from "@fit-check/schema/redraw-spec.ts";

/**
 * The Fit Check tools offered to Claude over MCP (Roy, 2026-11-17: "a full MCP to run the app and site from Claude").
 *
 * Every tool acts for the user the token belongs to. `db` is the service-role client (see _shared/auth.ts for why a
 * user-token client does not work inside the Edge runtime), so EVERY query below filters on `user_id` explicitly and
 * storage paths are checked to start with the user's folder. A query without that filter is a data leak.
 *
 * Phase 2 (outfit.ts, photos.ts): today's outfit and wear logging, adding garments from photos, redraw and re-cut.
 */

export type ToolContext = {
  /** Service role: bypasses RLS, so ownership is enforced by the `user_id` filter in every query. */
  db: SupabaseClient;
  userId: string;
  supabaseUrl: string;
};

export type ToolContent =
  | { type: "text"; text: string }
  | { type: "image"; data: string; mimeType: string };

export type ToolResult = { content: ToolContent[]; isError?: boolean };

type Tool = {
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean; idempotentHint?: boolean; openWorldHint?: boolean };
  run: (args: unknown, ctx: ToolContext) => Promise<ToolResult>;
};

const text = (value: unknown): ToolResult => ({
  content: [{ type: "text", text: typeof value === "string" ? value : JSON.stringify(value, null, 2) }],
});
const fail = (message: string): ToolResult => ({ content: [{ type: "text", text: message }], isError: true });

const ITEM_COLUMNS = "id,name,brand,tags,status,availability,cutout_path,thumb_path,notes,created_at";
/** A list is for choosing, not for reading every tag: this keeps a 100-item wardrobe well inside one reply. */
const MAX_LIST = 200;

type ItemRow = {
  id: string;
  name: string;
  brand: string | null;
  tags: ItemTags;
  status: string;
  availability: string;
  cutout_path: string | null;
  thumb_path: string | null;
  notes: string | null;
  created_at: string;
};

/** Garment images for this request: R2 first, then the Supabase `cutouts` bucket (see _shared/objects.ts). */
export const garmentsOf = (ctx: ToolContext) => garmentStore(ctx.db.storage.from(GARMENT_BUCKET));

/** Where Claude can load a garment image from; R2 when it is configured, so showing images costs no egress. */
export const publicUrl = (ctx: ToolContext, path: string | null) => (path ? garmentsOf(ctx).publicUrl(path) : null);

function summary(row: ItemRow, ctx: ToolContext) {
  const t = row.tags;
  return {
    id: row.id,
    name: row.name,
    brand: row.brand,
    type: t.subcategory,
    category: t.category,
    color: t.color_name,
    pattern: t.pattern,
    material: t.material,
    sleeve: t.sleeve,
    formality: t.formality,
    seasons: t.seasons,
    temp_c: [t.temp_min_c, t.temp_max_c],
    status: row.status,
    availability: row.availability,
    image_url: publicUrl(ctx, row.thumb_path ?? row.cutout_path),
  };
}

/** The hot columns duplicated out of `tags` for SQL filters (migration 0001); they must move with the tags. */
function tagColumns(t: ItemTags) {
  return {
    tags: t,
    category: t.category,
    subcategory: t.subcategory,
    color_hex: t.color_hex,
    color_name: t.color_name,
    pattern: t.pattern,
    material: t.material,
    formality: t.formality,
    seasons: t.seasons,
    temp_min_c: t.temp_min_c,
    temp_max_c: t.temp_max_c,
    modesty_flags: t.modesty_flags,
  };
}

async function loadItem(ctx: ToolContext, id: string): Promise<ItemRow | null> {
  const { data, error } = await ctx.db.from("items").select(ITEM_COLUMNS).eq("id", id).eq("user_id", ctx.userId).maybeSingle();
  if (error) throw new Error(error.message);
  return (data as ItemRow | null) ?? null;
}

// ---------------------------------------------------------------------------------------------------------------
// Inputs. Validated with zod before anything runs; the JSON Schemas below are what Claude sees.

const SearchInput = z.object({
  type: z.enum(SUBCATEGORIES).optional(),
  category: z.enum(["top", "bottom", "shoes", "layer", "outerwear", "accessory"]).optional(),
  color: z.enum(COLOR_NAMES).optional(),
  season: z.enum(SEASONS).optional(),
  text: z.string().max(80).optional(),
  status: z.enum(["active", "archived", "all"]).default("active"),
});

const IdInput = z.object({ id: z.string().uuid() });
const GetInput = IdInput.extend({ include_image: z.boolean().default(true) });

const TagPatch = z
  .object({
    subcategory: z.enum(SUBCATEGORIES),
    color_hex: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
    color_name: z.enum(COLOR_NAMES),
    secondary_color_hex: z.string().regex(/^#[0-9A-Fa-f]{6}$/).nullable(),
    pattern: z.enum(PATTERNS),
    material: z.enum(MATERIALS),
    fit: z.enum(FITS),
    sleeve: z.enum(SLEEVES),
    formality: z.number().int().min(1).max(10),
    seasons: z.array(z.enum(SEASONS)).min(1),
    temp_min_c: z.number().int().min(-10).max(45),
    temp_max_c: z.number().int().min(-10).max(45),
    modesty_flags: z.array(z.enum(MODESTY_FLAGS)),
    style_tags: z.array(z.enum(STYLE_TAGS)),
  })
  .partial()
  .strict();

const UpdateInput = IdInput.extend({
  name: z.string().min(2).max(80).optional(),
  brand: z.string().max(60).nullable().optional(),
  notes: z.string().max(500).nullable().optional(),
  tags: TagPatch.optional(),
});

const SpendInput = z.object({ days: z.number().int().min(1).max(90).default(30) });

const enumOf = (values: readonly string[]) => ({ type: "string", enum: [...values] });

// ---------------------------------------------------------------------------------------------------------------

export const TOOLS: Tool[] = [
  {
    name: "wardrobe_search",
    title: "Search the wardrobe",
    description:
      "Lists garments in Roy's wardrobe with their main tags and an image URL. All filters are optional and combine with AND. " +
      "Use it to answer what he owns, to find an item's id before editing it, or to plan an outfit. Archived (removed) items only with status archived or all.",
    inputSchema: {
      type: "object",
      properties: {
        type: { ...enumOf(SUBCATEGORIES), description: "Garment type (subcategory)." },
        category: { ...enumOf(["top", "bottom", "shoes", "layer", "outerwear", "accessory"]), description: "Outfit slot." },
        color: enumOf(COLOR_NAMES),
        season: enumOf(SEASONS),
        text: { type: "string", description: "Case-insensitive match on name or brand." },
        status: { ...enumOf(["active", "archived", "all"]), default: "active" },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true },
    async run(args, ctx) {
      const input = SearchInput.parse(args ?? {});
      let q = ctx.db.from("items").select(ITEM_COLUMNS).eq("user_id", ctx.userId).order("created_at", { ascending: true }).limit(MAX_LIST);
      if (input.status !== "all") q = q.eq("status", input.status);
      if (input.type) q = q.eq("subcategory", input.type);
      if (input.category) q = q.eq("category", input.category);
      if (input.color) q = q.eq("color_name", input.color);
      if (input.season) q = q.contains("seasons", [input.season]);
      if (input.text) {
        // Commas and parentheses would break the PostgREST or() syntax; they never matter for a name search.
        const term = input.text.replace(/[,()*%]/g, " ").trim();
        if (term) q = q.or(`name.ilike.*${term}*,brand.ilike.*${term}*`);
      }
      const { data, error } = await q;
      if (error) return fail(`Search failed: ${error.message}`);
      const rows = (data ?? []) as ItemRow[];
      return text({ count: rows.length, items: rows.map((r) => summary(r, ctx)) });
    },
  },
  {
    name: "item_get",
    title: "Show one garment",
    description: "Full details of one garment (every tag, notes, image) by id. Returns the garment's photo so you can see it.",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string", format: "uuid" }, include_image: { type: "boolean", default: true } },
      required: ["id"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true },
    async run(args, ctx) {
      const input = GetInput.parse(args);
      const row = await loadItem(ctx, input.id);
      if (!row) return fail("No garment with that id in this wardrobe.");
      const content: ToolContent[] = [
        { type: "text", text: JSON.stringify({ ...summary(row, ctx), tags: row.tags, notes: row.notes, created_at: row.created_at }, null, 2) },
      ];
      const path = row.thumb_path ?? row.cutout_path;
      if (input.include_image && path && path.startsWith(`${ctx.userId}/`)) {
        const bytes = await garmentsOf(ctx).read(path);
        if (bytes && bytes.length < 3_000_000) {
          let s = "";
          for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
          content.push({ type: "image", data: btoa(s), mimeType: sniffImageType(bytes, path.endsWith(".png") ? "image/png" : "image/jpeg") });
        }
      }
      return { content };
    },
  },
  {
    name: "item_update",
    title: "Edit a garment",
    description:
      "Changes a garment's name, brand, notes or any of its tags. Send only the fields to change; tags are merged into the existing ones " +
      "and the whole set is validated (category follows the type automatically). Use the exact enum values. " +
      "Confirm with Roy before changing several items at once.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", format: "uuid" },
        name: { type: "string" },
        brand: { type: ["string", "null"] },
        notes: { type: ["string", "null"] },
        tags: {
          type: "object",
          additionalProperties: false,
          properties: {
            subcategory: enumOf(SUBCATEGORIES),
            color_hex: { type: "string", pattern: "^#[0-9A-Fa-f]{6}$" },
            color_name: enumOf(COLOR_NAMES),
            secondary_color_hex: { type: ["string", "null"] },
            pattern: enumOf(PATTERNS),
            material: enumOf(MATERIALS),
            fit: enumOf(FITS),
            sleeve: enumOf(SLEEVES),
            formality: { type: "integer", minimum: 1, maximum: 10 },
            seasons: { type: "array", items: enumOf(SEASONS), minItems: 1 },
            temp_min_c: { type: "integer" },
            temp_max_c: { type: "integer" },
            modesty_flags: { type: "array", items: enumOf(MODESTY_FLAGS) },
            style_tags: { type: "array", items: enumOf(STYLE_TAGS) },
          },
        },
      },
      required: ["id"],
      additionalProperties: false,
    },
    annotations: { idempotentHint: true },
    async run(args, ctx) {
      const input = UpdateInput.parse(args);
      const row = await loadItem(ctx, input.id);
      if (!row) return fail("No garment with that id in this wardrobe.");
      const merged = { ...row.tags, ...(input.tags ?? {}) };
      const tags = ItemTagsSchema.safeParse({ ...merged, category: SUBCATEGORY_TO_CATEGORY[merged.subcategory], color_hex: merged.color_hex.toUpperCase() });
      if (!tags.success) return fail(`Invalid tags: ${tags.error.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("; ")}`);
      const patch: Record<string, unknown> = { ...tagColumns(tags.data), updated_at: new Date().toISOString() };
      if (input.name !== undefined) patch.name = input.name.trim();
      if (input.brand !== undefined) patch.brand = input.brand?.trim() || null;
      if (input.notes !== undefined) patch.notes = input.notes?.trim() || null;
      const { error } = await ctx.db.from("items").update(patch).eq("id", input.id).eq("user_id", ctx.userId);
      if (error) return fail(`Update failed: ${error.message}`);
      const after = await loadItem(ctx, input.id);
      return text({ updated: after ? summary(after, ctx) : input.id });
    },
  },
  {
    name: "item_archive",
    title: "Remove a garment",
    description:
      "Removes a garment from the wardrobe and from every suggestion. It is archived, not deleted: wear history stays and item_restore brings it back. " +
      "Ask Roy before removing.",
    inputSchema: { type: "object", properties: { id: { type: "string", format: "uuid" } }, required: ["id"], additionalProperties: false },
    annotations: { destructiveHint: true, idempotentHint: true },
    async run(args, ctx) {
      const { id } = IdInput.parse(args);
      const { data, error } = await ctx.db.from("items").update({ status: "archived", updated_at: new Date().toISOString() }).eq("id", id).eq("user_id", ctx.userId).select("name").maybeSingle();
      if (error) return fail(`Archive failed: ${error.message}`);
      return data ? text(`Removed "${data.name}". item_restore brings it back.`) : fail("No garment with that id in this wardrobe.");
    },
  },
  {
    name: "item_restore",
    title: "Bring back a removed garment",
    description: "Returns an archived garment to the wardrobe.",
    inputSchema: { type: "object", properties: { id: { type: "string", format: "uuid" } }, required: ["id"], additionalProperties: false },
    annotations: { idempotentHint: true },
    async run(args, ctx) {
      const { id } = IdInput.parse(args);
      const { data, error } = await ctx.db.from("items").update({ status: "active", updated_at: new Date().toISOString() }).eq("id", id).eq("user_id", ctx.userId).select("name").maybeSingle();
      if (error) return fail(`Restore failed: ${error.message}`);
      return data ? text(`"${data.name}" is back in the wardrobe.`) : fail("No garment with that id in this wardrobe.");
    },
  },
  {
    name: "spend_summary",
    title: "AI spending",
    description: "What the app's AI calls cost: per provider and task over the last N days (default 30), plus this calendar month's Google spend against the $8 cap.",
    inputSchema: {
      type: "object",
      properties: { days: { type: "integer", minimum: 1, maximum: 90, default: 30 } },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true },
    async run(args, ctx) {
      const { days } = SpendInput.parse(args ?? {});
      const since = new Date(Date.now() - days * 86_400_000).toISOString();
      const now = new Date();
      const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
      const from = since < monthStart ? since : monthStart;
      const { data, error } = await ctx.db.from("ai_calls").select("provider,task,cost_usd,ok,created_at").eq("user_id", ctx.userId).gte("created_at", from).limit(20_000);
      if (error) return fail(`Could not read ai_calls: ${error.message}`);
      const rows = (data ?? []) as Array<{ provider: string; task: string; cost_usd: number | null; ok: boolean; created_at: string }>;
      const byKey = new Map<string, { calls: number; failed: number; usd: number }>();
      let googleMonth = 0;
      for (const r of rows) {
        if (r.provider === "google" && r.created_at >= monthStart) googleMonth += r.cost_usd ?? 0;
        if (r.created_at < since) continue;
        const key = `${r.provider}/${r.task}`;
        const cur = byKey.get(key) ?? { calls: 0, failed: 0, usd: 0 };
        cur.calls++;
        if (!r.ok) cur.failed++;
        cur.usd += r.cost_usd ?? 0;
        byKey.set(key, cur);
      }
      const round = (n: number) => Math.round(n * 1000) / 1000;
      return text({
        days,
        by_provider_task: Object.fromEntries([...byKey].map(([k, v]) => [k, { ...v, usd: round(v.usd) }])),
        total_usd: round([...byKey.values()].reduce((s, v) => s + v.usd, 0)),
        google_this_month_usd: round(googleMonth),
        google_monthly_cap_usd: 8,
      });
    },
  },
  {
    name: "outfit_today",
    title: "Today's outfit candidates",
    description:
      "Builds today's outfit candidates with the app's own engine: weather (Tel Aviv by default), the day's rules, " +
      "laundry and what Roy wore recently. YOU are the stylist: pick one candidate and explain it to Roy in Hebrew. " +
      "The rules are, in this order: a day_type you pass; else the date's occasion context (see context_set: date, interview or event); " +
      "else the calendar (weekday, Shabbat, holiday), where, if Roy's profile says he does not keep Shabbat and holidays, Shabbat is planned as a " +
      "weekday and a holiday as a weekday one step dressier. The answer says which context was used and why (context_used). " +
      "Optional: date (yyyy-mm-dd), day_type, lat/lon for another place, anchor_item_id to build around one garment.",
    inputSchema: {
      type: "object",
      properties: {
        date: { type: "string", format: "date" },
        day_type: enumOf(["weekday", "shabbat", "holiday"]),
        lat: { type: "number" },
        lon: { type: "number" },
        anchor_item_id: { type: "string", format: "uuid" },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
    run: outfitToday,
  },
  {
    name: "context_set",
    title: "Tell the app what kind of day it is",
    description:
      "Sets the occasion for a date so the app dresses Roy for it: date (a date with someone), interview, or event (a formal occasion). " +
      "Use it when his calendar shows one. One context per date: it replaces any other occasion of that date. " +
      "date defaults to today; dates more than 14 days ahead or 1 day back are refused. source: calendar (default, you inferred it) or manual (Roy told you outright). " +
      "label (optional, up to 60 characters, one line) is a SHORT GENERIC description such as \"job interview\" or \"family event, evening\": " +
      "never a person's name, never the calendar event's title word for word. No person's name is accepted or stored. " +
      "ASK ROY BEFORE overriding a context he set by hand (source manual): such a write with source calendar is refused; if he agrees, call again with source manual. " +
      "It never touches Shabbat, holidays, reserve duty or trips. Returns what was stored and which rules today's outfit now follows.",
    inputSchema: {
      type: "object",
      properties: {
        type: { ...enumOf(["date", "interview", "event"]), description: "date = a date with someone; interview = a job interview; event = a formal occasion." },
        date: { type: "string", format: "date", description: "yyyy-mm-dd, default today (Israel time)." },
        label: { type: "string", minLength: 1, maxLength: 60, description: "Short generic description, one line. No names, no verbatim event title." },
        source: { ...enumOf(["calendar", "manual"]), default: "calendar" },
      },
      required: ["type"],
      additionalProperties: false,
    },
    annotations: { idempotentHint: true },
    run: contextSet,
  },
  {
    name: "context_get",
    title: "What kind of day is it set to",
    description:
      "The occasion context stored for a date (type, label, whether it was set by hand or from the calendar, when), or \"none\"; " +
      "plus observes_shabbat: whether Roy's profile says he keeps Shabbat and holidays. date defaults to today. " +
      "Check it before context_set, and before doing anything on a Saturday or holiday for someone who keeps them.",
    inputSchema: { type: "object", properties: { date: { type: "string", format: "date" } }, additionalProperties: false },
    annotations: { readOnlyHint: true },
    run: contextGet,
  },
  {
    name: "context_clear",
    title: "Remove the day's occasion",
    description:
      "Removes the occasion context of a date (default today), for example when the calendar event was cancelled; " +
      "the day goes back to the calendar's rules. Succeeds quietly when none is set. Same date window as context_set. " +
      "If the removed context was set by hand, say so to Roy.",
    inputSchema: { type: "object", properties: { date: { type: "string", format: "date" } }, additionalProperties: false },
    annotations: { destructiveHint: true, idempotentHint: true },
    run: contextClear,
  },
  {
    name: "outfit_log",
    title: "Log an outfit",
    description:
      "Records Roy's answer to an outfit, as the app's buttons do: worn (default), skipped or disliked. Updates which garments go well " +
      "together and sends garments due for washing to the laundry. Use the item ids from outfit_today or wardrobe_search.",
    inputSchema: {
      type: "object",
      properties: {
        item_ids: { type: "array", items: { type: "string", format: "uuid" }, minItems: 2, maxItems: 5 },
        feedback: { ...enumOf(["worn", "skipped", "disliked"]), default: "worn" },
        date: { type: "string", format: "date" },
        day_type: enumOf(["weekday", "shabbat", "holiday"]),
      },
      required: ["item_ids"],
      additionalProperties: false,
    },
    run: outfitLog,
  },
  {
    name: "intake_pending",
    title: "Photos waiting to be added",
    description:
      "Shows the photos Roy uploaded in the app with \"for Claude\" (up to 6 at a time; offset for more). Tag each garment yourself, " +
      "confirm with Roy, then item_create. No AI cost: you are the tagger.",
    inputSchema: { type: "object", properties: { offset: { type: "integer", minimum: 0, default: 0 } }, additionalProperties: false },
    annotations: { readOnlyHint: true },
    run: intakePending,
  },
  {
    name: "item_create",
    title: "Add a garment from a pending photo",
    description:
      "Adds one garment from an intake_pending photo with the name and tags YOU chose, removes the background (free) and saves it. " +
      "Name style: English \"Brand Type\" (e.g. \"Gant Oxford Shirt\"). Category follows the type automatically. " +
      "Several garments in one photo: pass crop (the garment's box) and keep_pending: true for every garment but the last.",
    inputSchema: {
      type: "object",
      properties: {
        photo_path: { type: "string" },
        crop: {
          type: "object",
          description: "Box around ONE garment, as fractions of the photo's width and height (0-1, top-left origin). Use when the photo shows several garments.",
          properties: { x: { type: "number", minimum: 0, maximum: 1 }, y: { type: "number", minimum: 0, maximum: 1 }, w: { type: "number", minimum: 0.02, maximum: 1 }, h: { type: "number", minimum: 0.02, maximum: 1 } },
          required: ["x", "y", "w", "h"],
          additionalProperties: false,
        },
        keep_pending: { type: "boolean", default: false, description: "true: leave the photo in the queue for its other garments." },
        name: { type: "string" },
        brand: { type: ["string", "null"] },
        tags: {
          type: "object",
          additionalProperties: false,
          required: ["subcategory", "color_hex", "color_name", "pattern", "material", "sleeve", "formality", "seasons", "temp_min_c", "temp_max_c"],
          properties: {
            subcategory: enumOf(SUBCATEGORIES),
            color_hex: { type: "string", pattern: "^#[0-9A-Fa-f]{6}$" },
            color_name: enumOf(COLOR_NAMES),
            secondary_color_hex: { type: ["string", "null"] },
            pattern: enumOf(PATTERNS),
            material: enumOf(MATERIALS),
            fit: enumOf(FITS),
            sleeve: enumOf(SLEEVES),
            formality: { type: "integer", minimum: 1, maximum: 10 },
            seasons: { type: "array", items: enumOf(SEASONS), minItems: 1 },
            temp_min_c: { type: "integer" },
            temp_max_c: { type: "integer" },
            modesty_flags: { type: "array", items: enumOf(MODESTY_FLAGS) },
            style_tags: { type: "array", items: enumOf(STYLE_TAGS) },
          },
        },
      },
      required: ["photo_path", "name", "tags"],
      additionalProperties: false,
    },
    run: itemCreate,
  },
  {
    name: "intake_dismiss",
    title: "Remove a photo from the queue",
    description: "Removes a pending photo without adding anything: not a garment, a duplicate, or all its garments are already added.",
    inputSchema: { type: "object", properties: { photo_path: { type: "string" } }, required: ["photo_path"], additionalProperties: false },
    annotations: { destructiveHint: true, idempotentHint: true },
    run: intakeDismiss,
  },
  {
    name: "item_recrop",
    title: "Re-crop a garment's original photo",
    description:
      "Replaces a garment's stored original photo with a crop of it (for items created from a photo of several garments). " +
      "The full photo is kept as a backup; requeue_original puts a copy back in intake_pending for the other garments; " +
      "recut also re-runs background removal on the crop and sets it as the image (leave false to keep a redraw).",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", format: "uuid" },
        crop: {
          type: "object",
          description: "Box around ONE garment, as fractions of the photo's width and height (0-1, top-left origin). ",
          properties: { x: { type: "number", minimum: 0, maximum: 1 }, y: { type: "number", minimum: 0, maximum: 1 }, w: { type: "number", minimum: 0.02, maximum: 1 }, h: { type: "number", minimum: 0.02, maximum: 1 } },
          required: ["x", "y", "w", "h"],
          additionalProperties: false,
        },
        recut: { type: "boolean", default: false },
        requeue_original: { type: "boolean", default: false },
      },
      required: ["id", "crop"],
      additionalProperties: false,
    },
    run: itemRecrop,
  },
  {
    name: "item_redraw",
    title: "AI redraw of a garment (paid)",
    description:
      "Redraws a photo garment as a clean product image (Google image model, about $0.034, counted against the $8 monthly cap) and sets it as " +
      "its image. Two ways: (a) write the description yourself from the photo, in English: colour, fabric, collar, pockets, logos, sleeves " +
      "(e.g. \"white cotton oxford shirt, button-down collar, chest pocket with a small red flag logo, long sleeves\"); or (b) leave description " +
      "out and pick details from the app's vocabulary, built on the item's tags and stored for the app's next redraw. Either way, fixes " +
      "(remove_behind = drop the garment behind it, complete_hidden, smooth_creases, true_colour, sharp_texture) and up to two short notes " +
      "(may be Hebrew) can be added. Ask Roy first.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", format: "uuid" },
        description: { type: "string", minLength: 10, maxLength: 400 },
        details: { type: "array", items: { type: "string", enum: [...REDRAW_DETAIL_IDS] }, maxItems: 6, description: "Only without description; must fit the garment type, one per group (one collar, one sole...)." },
        fixes: { type: "array", items: { type: "string", enum: [...REDRAW_FIX_IDS] } },
        notes: {
          type: "array",
          maxItems: 2,
          items: {
            type: "object",
            properties: { kind: { type: "string", enum: ["detail", "fix"] }, text: { type: "string", minLength: 2, maxLength: 60 } },
            required: ["kind", "text"],
            additionalProperties: false,
          },
        },
      },
      required: ["id"],
      additionalProperties: false,
    },
    annotations: { openWorldHint: true },
    run: itemRedraw,
  },
  {
    name: "item_recut",
    title: "Redo a garment's background removal",
    description: "Runs background removal again on a photo garment's original photo (free) and sets the result as its image.",
    inputSchema: { type: "object", properties: { id: { type: "string", format: "uuid" } }, required: ["id"], additionalProperties: false },
    annotations: { idempotentHint: true },
    run: itemRecut,
  },
];

export const TOOL_BY_NAME = new Map(TOOLS.map((t) => [t.name, t]));
