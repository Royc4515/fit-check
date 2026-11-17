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
} from "@fit-check/schema/item-tags.ts";
import { cutout } from "../_shared/ai/modal.ts";
import { ENHANCE_MODEL, enhanceGarment } from "../_shared/ai/gemini.ts";
import { MONTHLY_GOOGLE_BUDGET_USD, monthlyGoogleSpend } from "../_shared/ai/budget.ts";
import { sniffImageType } from "../_shared/media.ts";
import type { ToolContent, ToolContext, ToolResult } from "./tools.ts";

/**
 * Photo work over MCP (Roy, 2026-11-17, phase 2): garments Roy uploads with the app's "for Claude" button, and
 * image fixes on existing items.
 *
 * Cost rule (Roy: "cut paid AI steps where you can do them yourself"): Claude in the chat looks at the photo and
 * writes the tags and the redraw description itself, so item_create calls no tagger and item_redraw needs one paid
 * call. The cutout runs on the Modal worker (free credit). Every write is checked against ctx.userId.
 */

const PENDING = (uid: string) => `${uid}/pending`;
/** A batch Claude can look at in one answer without blowing up the context. */
const MAX_PREVIEW = 6;

const text = (value: unknown): ToolResult => ({ content: [{ type: "text", text: typeof value === "string" ? value : JSON.stringify(value, null, 2) }] });
const fail = (message: string): ToolResult => ({ content: [{ type: "text", text: message }], isError: true });
const b64 = (bytes: Uint8Array) => {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
};

const TagsInput = z.object({
  subcategory: z.enum(SUBCATEGORIES),
  color_hex: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
  color_name: z.enum(COLOR_NAMES),
  secondary_color_hex: z.string().regex(/^#[0-9A-Fa-f]{6}$/).nullable().default(null),
  pattern: z.enum(PATTERNS),
  material: z.enum(MATERIALS),
  fit: z.enum(FITS).default("regular"),
  sleeve: z.enum(SLEEVES),
  formality: z.number().int().min(1).max(10),
  seasons: z.array(z.enum(SEASONS)).min(1),
  temp_min_c: z.number().int().min(-10).max(45),
  temp_max_c: z.number().int().min(-10).max(45),
  modesty_flags: z.array(z.enum(MODESTY_FLAGS)).default([]),
  style_tags: z.array(z.enum(STYLE_TAGS)).default([]),
});

const PendingInput = z.object({ offset: z.number().int().min(0).default(0) });
const CreateInput = z.object({
  photo_path: z.string().min(5).max(300),
  name: z.string().min(2).max(80),
  brand: z.string().max(60).nullable().default(null),
  tags: TagsInput,
});
const RedrawInput = z.object({ id: z.string().uuid(), description: z.string().min(10).max(400) });
const IdInput = z.object({ id: z.string().uuid() });

/** The original photo an item was cut from (`…/N.jpg`), whatever its current image is called. */
function sourceCrop(path: string | null): string | null {
  const m = path?.match(/^(.*\/)(\d+)[^/]*\.(?:jpe?g|png)$/);
  return m ? `${m[1]}${m[2]}.jpg` : null;
}

async function download(ctx: ToolContext, path: string): Promise<Uint8Array | null> {
  if (!path.startsWith(`${ctx.userId}/`) || path.includes("..")) return null;
  const { data } = await ctx.db.storage.from("cutouts").download(path);
  return data ? new Uint8Array(await data.arrayBuffer()) : null;
}

/** Cuts out `bytes` on the worker and stores `<stem>-cutout.png` / `<stem>-thumb.png`; null when the worker failed. */
async function cutAndStore(ctx: ToolContext, bytes: Uint8Array, stem: string, isolate: boolean) {
  const cut = await cutout(bytes, sniffImageType(bytes, "image/jpeg"), isolate);
  if (!cut.ok && cut.notConfigured) return null;
  await ctx.db.from("ai_calls").insert({ user_id: ctx.userId, ...cut.log });
  if (!cut.ok) return null;
  const [a, b] = await Promise.all([
    ctx.db.storage.from("cutouts").upload(`${stem}-cutout.png`, cut.cutout, { contentType: "image/png", upsert: true }),
    ctx.db.storage.from("cutouts").upload(`${stem}-thumb.png`, cut.thumb, { contentType: "image/png", upsert: true }),
  ]);
  return a.error || b.error ? null : { image: `${stem}-cutout.png`, thumb: `${stem}-thumb.png` };
}

export async function intakePending(args: unknown, ctx: ToolContext): Promise<ToolResult> {
  const { offset } = PendingInput.parse(args ?? {});
  const { data, error } = await ctx.db.storage.from("cutouts").list(PENDING(ctx.userId), { limit: 100, sortBy: { column: "created_at", order: "asc" } });
  if (error) return fail(`Could not list pending photos: ${error.message}`);
  const files = (data ?? []).filter((f) => /\.(jpe?g|png|webp)$/i.test(f.name));
  const page = files.slice(offset, offset + MAX_PREVIEW);
  const content: ToolContent[] = [
    {
      type: "text",
      text: JSON.stringify({
        total_pending: files.length,
        showing: page.map((f, i) => ({ index: offset + i, photo_path: `${PENDING(ctx.userId)}/${f.name}` })),
        how_to_answer:
          "Look at each photo, tag the main garment yourself (exact enum values; check wardrobe_search for a duplicate first), " +
          "show Roy the proposed name and tags in Hebrew, and call item_create after he confirms.",
      }),
    },
  ];
  for (const f of page) {
    const bytes = await download(ctx, `${PENDING(ctx.userId)}/${f.name}`);
    if (bytes && bytes.length < 4_000_000) content.push({ type: "image", data: b64(bytes), mimeType: sniffImageType(bytes, "image/jpeg") });
  }
  return { content };
}

export async function itemCreate(args: unknown, ctx: ToolContext): Promise<ToolResult> {
  const input = CreateInput.parse(args);
  if (!input.photo_path.startsWith(`${PENDING(ctx.userId)}/`) || input.photo_path.includes("..")) return fail("photo_path must be one of intake_pending's photos.");
  const tags = ItemTagsSchema.safeParse({ ...input.tags, category: SUBCATEGORY_TO_CATEGORY[input.tags.subcategory], color_hex: input.tags.color_hex.toUpperCase() });
  if (!tags.success) return fail(`Invalid tags: ${tags.error.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("; ")}`);

  // Moved into the intake layout (`intake/<id>/1.jpg`) so the app's redraw and re-cut find the original as N.jpg.
  const folder = `${ctx.userId}/intake/${Date.now()}-mcp`;
  const crop = `${folder}/1.jpg`;
  const moved = await ctx.db.storage.from("cutouts").move(input.photo_path, crop);
  if (moved.error) return fail(`Could not move the photo: ${moved.error.message}`);
  const bytes = await download(ctx, crop);
  const stored = bytes ? await cutAndStore(ctx, bytes, `${folder}/1`, true) : null;

  const t = tags.data;
  const { data, error } = await ctx.db
    .from("items")
    .insert({
      user_id: ctx.userId,
      external_id: `photo:${folder.split("/").pop()}/1.jpg`,
      name: input.name.trim(),
      brand: input.brand?.trim() || null,
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
      status: "active",
      availability: "home",
      source: "photo",
      cutout_path: stored?.image ?? crop,
      thumb_path: stored?.thumb ?? null,
    })
    .select("id")
    .single();
  if (error) return fail(`Saved the photo but not the item: ${error.message}`);
  return text({ created: input.name, id: data.id, background_removed: stored !== null, next: "item_redraw for a product-photo look (paid, ask first)" });
}

export async function itemRedraw(args: unknown, ctx: ToolContext): Promise<ToolResult> {
  const input = RedrawInput.parse(args);
  const { data: item } = await ctx.db.from("items").select("id,name,cutout_path").eq("id", input.id).eq("user_id", ctx.userId).maybeSingle();
  if (!item) return fail("No garment with that id in this wardrobe.");
  const crop = sourceCrop(item.cutout_path as string | null);
  if (!crop) return fail("This garment has no original photo to redraw.");
  const spent = await monthlyGoogleSpend();
  if (spent === null || spent >= MONTHLY_GOOGLE_BUDGET_USD) return fail(`The monthly Google budget ($${MONTHLY_GOOGLE_BUDGET_USD}) is used up; redraws resume next month.`);
  const bytes = await download(ctx, crop);
  if (!bytes) return fail("The original photo is missing.");

  const drawn = await enhanceGarment(bytes, sniffImageType(bytes, "image/jpeg"), input.description);
  await ctx.db.from("ai_calls").insert({ user_id: ctx.userId, ...drawn.log });
  if (!drawn.png) return fail(`Redraw failed: ${drawn.log.error ?? "unknown"}`);
  const stem = crop.replace(/\.jpg$/, `-enhanced-${Date.now()}`);
  const up = await ctx.db.storage.from("cutouts").upload(`${stem}.png`, drawn.png, { contentType: sniffImageType(drawn.png, "image/png") });
  if (up.error) return fail(`Could not store the redraw: ${up.error.message}`);
  // A redraw shows one garment on white: plain cutout, no SAM.
  const stored = await cutAndStore(ctx, drawn.png, stem, false);
  const { error } = await ctx.db
    .from("items")
    .update({ cutout_path: stored?.image ?? `${stem}.png`, thumb_path: stored?.thumb ?? null, updated_at: new Date().toISOString() })
    .eq("id", input.id)
    .eq("user_id", ctx.userId);
  if (error) return fail(`Redrawn, but the item was not updated: ${error.message}`);
  return text({ redrawn: item.name, model: ENHANCE_MODEL, cost_usd: drawn.log.cost_usd, background_removed: stored !== null });
}

export async function itemRecut(args: unknown, ctx: ToolContext): Promise<ToolResult> {
  const { id } = IdInput.parse(args);
  const { data: item } = await ctx.db.from("items").select("id,name,cutout_path").eq("id", id).eq("user_id", ctx.userId).maybeSingle();
  if (!item) return fail("No garment with that id in this wardrobe.");
  const crop = sourceCrop(item.cutout_path as string | null);
  const bytes = crop ? await download(ctx, crop) : null;
  if (!crop || !bytes) return fail("This garment has no original photo.");
  const stored = await cutAndStore(ctx, bytes, crop.replace(/\.jpg$/, `-recut-${Date.now()}`), true);
  if (!stored) return fail("Background removal failed (the Modal worker did not answer).");
  const { error } = await ctx.db
    .from("items")
    .update({ cutout_path: stored.image, thumb_path: stored.thumb, updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("user_id", ctx.userId);
  if (error) return fail(`Cut out, but the item was not updated: ${error.message}`);
  return text({ recut: item.name, note: "Removes clothes hanging behind only once the SAM worker is deployed on Modal." });
}
