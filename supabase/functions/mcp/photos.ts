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
import {
  buildRedrawPrompt,
  garmentOf,
  REDRAW_DETAIL_IDS,
  REDRAW_FIX_IDS,
  REDRAW_FIXES,
  RedrawFreeSchema,
  redrawPrompt,
  RedrawSpecSchema,
  type RedrawSpec,
} from "@fit-check/schema/redraw-spec.ts";
import { removeBackground } from "../_shared/ai/background.ts";
import { ENHANCE_MODEL, enhanceGarment } from "../_shared/ai/gemini.ts";
import { whiteToTransparent } from "../_shared/whitebg.ts";
import { MONTHLY_GOOGLE_BUDGET_USD, monthlyGoogleSpend } from "../_shared/ai/budget.ts";
import { sniffImageType } from "../_shared/media.ts";
import { garmentsOf, type ToolContent, type ToolContext, type ToolResult } from "./tools.ts";

/**
 * Photo work over MCP (Roy, 2026-11-17, phase 2): garments Roy uploads with the app's "for Claude" button, and
 * image fixes on existing items.
 *
 * Cost rule (Roy: "cut paid AI steps where you can do them yourself"): Claude in the chat looks at the photo and
 * writes the tags and the redraw description itself, so item_create calls no tagger and item_redraw needs one paid
 * call. The cutout runs on the Modal worker (free credit). Every write is checked against ctx.userId.
 *
 * One pending photo may hold several garments (2026-11-17 bug: the first item_create moved the photo away and the
 * second failed). So item_create COPIES the photo, optionally crops it to the garment first, and clears it from
 * the queue only when keep_pending is false. Every item gets its own original, so archiving one never breaks another.
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

/** A box in the photo, as fractions of its width and height (0-1), top-left origin. */
const CropInput = z
  .object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1), w: z.number().min(0.02).max(1), h: z.number().min(0.02).max(1) })
  .refine((c) => c.x + c.w <= 1.001 && c.y + c.h <= 1.001, { message: "crop box goes past the photo edge" });
type Crop = z.infer<typeof CropInput>;

const PendingInput = z.object({ offset: z.number().int().min(0).default(0) });
const CreateInput = z.object({
  photo_path: z.string().min(5).max(300),
  name: z.string().min(2).max(80),
  brand: z.string().max(60).nullable().default(null),
  tags: TagsInput,
  crop: CropInput.optional(),
  keep_pending: z.boolean().default(false),
});
const DismissInput = z.object({ photo_path: z.string().min(5).max(300) });
const RecropInput = z.object({
  id: z.string().uuid(),
  crop: CropInput,
  recut: z.boolean().default(false),
  requeue_original: z.boolean().default(false),
});
/**
 * Either Claude's own description from the photo (best when it has looked at it), or the app composer's chips on top
 * of the item's tags. Fixes and owner notes go with either; details only without a description (it already says them).
 */
const RedrawInput = z
  .object({
    id: z.string().uuid(),
    description: z.string().min(10).max(400).optional(),
    details: z.array(z.enum(REDRAW_DETAIL_IDS)).optional(),
    fixes: z.array(z.enum(REDRAW_FIX_IDS)).optional(),
    notes: z.array(RedrawFreeSchema).max(2).optional(),
  })
  .refine((v) => !(v.description && v.details?.length), "details go in the description when one is given");
const IdInput = z.object({ id: z.string().uuid() });

/** The original photo an item was cut from (`…/N.jpg`), whatever its current image is called. */
function sourceCrop(path: string | null): string | null {
  const m = path?.match(/^(.*\/)(\d+)[^/]*\.(?:jpe?g|png)$/);
  return m ? `${m[1]}${m[2]}.jpg` : null;
}

/** Cuts the box out of a JPEG/PNG and returns it as JPEG. A small margin keeps sleeves and hems that touch the box. */
async function cropImage(bytes: Uint8Array, crop: Crop): Promise<Uint8Array> {
  // don't touch / the Deno build of imagescript (pure WASM), loaded only when a crop runs. The npm build loads a
  // native Node codec that the Edge runtime rejects ("unsupported arch/platform"), and as a static import it
  // crashed the whole mcp function at boot (v4, 2026-11-17). Dynamic, so a codec failure can only break cropping.
  const { decode, Image } = await import("https://deno.land/x/imagescript@1.3.0/mod.ts");
  const img = (await decode(bytes)) as InstanceType<typeof Image>;
  const pad = 0.01;
  const x0 = Math.max(0, Math.floor((crop.x - pad) * img.width));
  const y0 = Math.max(0, Math.floor((crop.y - pad) * img.height));
  const x1 = Math.min(img.width, Math.ceil((crop.x + crop.w + pad) * img.width));
  const y1 = Math.min(img.height, Math.ceil((crop.y + crop.h + pad) * img.height));
  return await img.crop(x0, y0, Math.max(1, x1 - x0), Math.max(1, y1 - y0)).encodeJPEG(92);
}

const isPending = (ctx: ToolContext, path: string) => path.startsWith(`${PENDING(ctx.userId)}/`) && !path.includes("..");

async function download(ctx: ToolContext, path: string): Promise<Uint8Array | null> {
  if (!path.startsWith(`${ctx.userId}/`) || path.includes("..")) return null;
  // R2 for garment images, Supabase for the pending queue the app uploads to (see _shared/objects.ts).
  return await garmentsOf(ctx).read(path);
}

/** Removes the background of `bytes` and stores `<stem>-cutout.png` / `<stem>-thumb.png`; null when that failed. */
async function cutAndStore(ctx: ToolContext, bytes: Uint8Array, stem: string, isolate: boolean) {
  const cut = await removeBackground(bytes, sniffImageType(bytes, "image/jpeg"), isolate, async (entry) => {
    await ctx.db.from("ai_calls").insert({ user_id: ctx.userId, ...entry });
  });
  if (!cut.ok) return null;
  const store = garmentsOf(ctx);
  const [a, b] = await Promise.all([store.write(`${stem}-cutout.png`, cut.cutout, "image/png"), store.write(`${stem}-thumb.png`, cut.thumb, "image/png")]);
  return a && b ? { image: `${stem}-cutout.png`, thumb: `${stem}-thumb.png` } : null;
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
          "Look at each photo and tag each garment yourself (exact enum values; check wardrobe_search for duplicates first), " +
          "show Roy the proposed names and tags in Hebrew, and call item_create after he confirms. A photo may show several " +
          "garments: call item_create once per garment with its crop box and keep_pending: true, and false on the last one " +
          "(or intake_dismiss when done). Photos that are not garments: intake_dismiss.",
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
  if (!isPending(ctx, input.photo_path)) return fail("photo_path must be one of intake_pending's photos.");
  const tags = ItemTagsSchema.safeParse({ ...input.tags, category: SUBCATEGORY_TO_CATEGORY[input.tags.subcategory], color_hex: input.tags.color_hex.toUpperCase() });
  if (!tags.success) return fail(`Invalid tags: ${tags.error.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("; ")}`);

  const photo = await download(ctx, input.photo_path);
  if (!photo) return fail("That pending photo is gone (already added or dismissed). Call intake_pending again.");
  let bytes: Uint8Array;
  try {
    bytes = input.crop ? await cropImage(photo, input.crop) : photo;
  } catch (error) {
    return fail(`Could not crop the photo: ${error instanceof Error ? error.message : String(error)}`);
  }
  // The item's own copy, in the intake layout (`intake/<id>/1.jpg`) so redraw and re-cut find the original as N.jpg.
  const folder = `${ctx.userId}/intake/${Date.now()}-mcp`;
  const crop = `${folder}/1.jpg`;
  if (!(await garmentsOf(ctx).write(crop, bytes, sniffImageType(bytes, "image/jpeg")))) return fail("Could not store the photo.");
  // SAM keeps the garment at the centre of the frame: right for a crop or a one-garment photo.
  const stored = await cutAndStore(ctx, bytes, `${folder}/1`, true);

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
  if (!input.keep_pending) await ctx.db.storage.from("cutouts").remove([input.photo_path]);
  return text({
    created: input.name,
    id: data.id,
    cropped: input.crop !== undefined,
    background_removed: stored !== null,
    still_pending: input.keep_pending,
    next: "item_redraw for a product-photo look (paid, ask first)",
  });
}

export async function intakeDismiss(args: unknown, ctx: ToolContext): Promise<ToolResult> {
  const { photo_path } = DismissInput.parse(args);
  if (!isPending(ctx, photo_path)) return fail("photo_path must be one of intake_pending's photos.");
  const { error } = await ctx.db.storage.from("cutouts").remove([photo_path]);
  return error ? fail(`Could not remove it: ${error.message}`) : text({ dismissed: photo_path });
}

/**
 * Replaces an item's stored original with a crop of it (the 2026-11-17 multi-garment photos). The full photo is kept
 * next to it as `N-full-<ts>.jpg`, and with requeue_original a copy goes back to pending for the other garments.
 */
export async function itemRecrop(args: unknown, ctx: ToolContext): Promise<ToolResult> {
  const input = RecropInput.parse(args);
  const { data: item } = await ctx.db.from("items").select("id,name,cutout_path").eq("id", input.id).eq("user_id", ctx.userId).maybeSingle();
  if (!item) return fail("No garment with that id in this wardrobe.");
  const original = sourceCrop(item.cutout_path as string | null);
  const bytes = original ? await download(ctx, original) : null;
  if (!original || !bytes) return fail("This garment has no original photo.");
  const ts = Date.now();
  const full = original.replace(/\.jpg$/, `-full-${ts}.jpg`);
  if (!(await garmentsOf(ctx).write(full, bytes, sniffImageType(bytes, "image/jpeg")))) return fail("Could not keep the full photo.");
  let requeued: string | null = null;
  if (input.requeue_original) {
    requeued = `${PENDING(ctx.userId)}/${ts}-requeued.jpg`;
    // Supabase on purpose: the pending queue is listed and filled by the app from that bucket.
    const q = await ctx.db.storage.from("cutouts").upload(requeued, bytes, { contentType: sniffImageType(bytes, "image/jpeg"), cacheControl: "31536000" });
    if (q.error) return fail(`Could not put the photo back in the queue: ${q.error.message}`);
  }
  let cropped: Uint8Array;
  try {
    cropped = await cropImage(bytes, input.crop);
  } catch (error) {
    return fail(`Could not crop the photo: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!(await garmentsOf(ctx).write(original, cropped, "image/jpeg"))) return fail("Could not store the crop.");
  let image: string | null = null;
  if (input.recut) {
    const stored = await cutAndStore(ctx, cropped, original.replace(/\.jpg$/, `-recut-${ts}`), true);
    if (stored) {
      await ctx.db.from("items").update({ cutout_path: stored.image, thumb_path: stored.thumb, updated_at: new Date().toISOString() }).eq("id", input.id).eq("user_id", ctx.userId);
      image = stored.image;
    }
  }
  return text({ recropped: item.name, original, full_photo_kept_as: full, requeued, new_image: image ?? "unchanged" });
}

export async function itemRedraw(args: unknown, ctx: ToolContext): Promise<ToolResult> {
  const input = RedrawInput.parse(args);
  const { data: item } = await ctx.db.from("items").select("id,name,tags,cutout_path").eq("id", input.id).eq("user_id", ctx.userId).maybeSingle();
  if (!item) return fail("No garment with that id in this wardrobe.");
  // Chips mode builds the same spec the app's composer would, so its checks (a detail the garment type cannot take,
  // two collars) apply here too, and the spec is stored for the app's next redraw of this item.
  let spec: RedrawSpec | null = null;
  if (!input.description) {
    const tags = ItemTagsSchema.safeParse(item.tags);
    if (!tags.success) return fail("This garment's tags are malformed; fix them with item_update first.");
    const parsed = RedrawSpecSchema.safeParse({
      v: 1,
      name: item.name,
      garment: garmentOf(tags.data),
      details: input.details ?? [],
      fixes: REDRAW_FIX_IDS.filter((f) => input.fixes?.includes(f)),
      free: input.notes ?? [],
    });
    if (!parsed.success) return fail(`Invalid redraw choices: ${parsed.error.issues.map((i) => i.message).join("; ")}`);
    spec = parsed.data;
  }
  const crop = sourceCrop(item.cutout_path as string | null);
  if (!crop) return fail("This garment has no original photo to redraw.");
  const spent = await monthlyGoogleSpend();
  if (spent === null || spent >= MONTHLY_GOOGLE_BUDGET_USD) return fail(`The monthly Google budget ($${MONTHLY_GOOGLE_BUDGET_USD}) is used up; redraws resume next month.`);
  const bytes = await download(ctx, crop);
  if (!bytes) return fail("The original photo is missing.");

  const prompt = spec
    ? buildRedrawPrompt(spec)
    : redrawPrompt(input.description ?? "", {
        fixes: REDRAW_FIX_IDS.filter((f) => input.fixes?.includes(f)).map((f) => REDRAW_FIXES[f]),
        notes: input.notes,
      });
  const drawn = await enhanceGarment(bytes, sniffImageType(bytes, "image/jpeg"), prompt);
  await ctx.db.from("ai_calls").insert({ user_id: ctx.userId, ...drawn.log });
  if (!drawn.png) return fail(`Redraw failed: ${drawn.log.error ?? "unknown"}`);
  const stem = crop.replace(/\.jpg$/, `-enhanced-${Date.now()}`);
  if (!(await garmentsOf(ctx).write(`${stem}.png`, drawn.png, sniffImageType(drawn.png, "image/png")))) return fail("Could not store the redraw.");
  // Roy, 2026-11-18: clear the white background right away, locally and free; the worker is only the fallback for
  // a redraw the check declined (and it was disabled that day, which left redraws on white).
  const clear = await whiteToTransparent(drawn.png).catch(() => null);
  let stored: { image: string; thumb: string | null } | null = null;
  if (clear) {
    if (await garmentsOf(ctx).write(`${stem}-cutout.png`, clear, "image/png")) stored = { image: `${stem}-cutout.png`, thumb: null };
  }
  // A redraw shows one garment on white: plain cutout, no SAM.
  stored ??= await cutAndStore(ctx, drawn.png, stem, false);
  const { error } = await ctx.db
    .from("items")
    .update({
      cutout_path: stored?.image ?? `${stem}.png`,
      thumb_path: stored?.thumb ?? null,
      ...(spec ? { redraw_spec: spec } : {}),
      updated_at: new Date().toISOString(),
    })
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
