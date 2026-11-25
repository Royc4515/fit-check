import {
  IntakeDetectResultSchema,
  IntakeEnhanceResultSchema,
  IntakeCutoutResultSchema,
  IntakeTagResultSchema,
  itemToInsertRow,
  type DetectedGarment,
  type IntakeCutoutResult,
  type IntakeDetectResult,
  type IntakeEnhanceResult,
  type IntakeTagResult,
  type ItemTags,
  type RedrawSpec,
  type TagProposal,
} from "@fit-check/schema";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import { FunctionsHttpError } from "@supabase/supabase-js";
import type { z } from "zod";
import { supabase } from "../lib/supabase";
import { isPreview, PreviewReadOnlyError } from "./preview";

/**
 * Long edge of the photo sent for detection and cropped from. 1600 keeps small details (logos, collars) for the
 * crops while uploads stay around 300-500KB instead of 4-8MB.
 */
const MAX_EDGE = 1600;
/**
 * Below this long edge a photo cannot show weave or yarn: Roy's first test photos were ~200 px and every fabric
 * came back wrong. The app still runs them, but says why the result will be rough.
 */
export const MIN_USEFUL_EDGE = 1000;
/** Extra margin around each detected box: detection boxes are tight and clip sleeves and shoe tips. */
const BOX_PADDING = 0.03;

export type PreparedPhoto = { uri: string; width: number; height: number };

/** Downscales and re-encodes a picked photo to JPEG. Also strips the HEIC and EXIF variety phones produce. */
export async function preparePhoto(uri: string, width: number, height: number): Promise<PreparedPhoto> {
  const scale = Math.min(1, MAX_EDGE / Math.max(width, height || 1));
  const context = ImageManipulator.manipulate(uri);
  if (scale < 1) context.resize({ width: Math.round(width * scale), height: Math.round(height * scale) });
  const image = await context.renderAsync();
  const saved = await image.saveAsync({ format: SaveFormat.JPEG, compress: 0.85 });
  return { uri: saved.uri, width: saved.width, height: saved.height };
}

/** ArrayBuffer, not Blob: supabase-js on React Native cannot upload a Blob read from a file:// URI. */
async function upload(bucket: string, path: string, uri: string): Promise<void> {
  // Design preview (web only, temporary): no upload. Every intake step starts here or in invoke(), so this blocks them all.
  if (isPreview()) throw new PreviewReadOnlyError(`upload to ${bucket}`);
  const bytes = await (await fetch(uri)).arrayBuffer();
  const { error } = await supabase.storage.from(bucket).upload(path, bytes, { contentType: "image/jpeg", cacheControl: "31536000" });
  if (error) throw error;
}

/**
 * "For Claude" (Roy, 2026-11-17): a photo of one garment parked in `cutouts/{uid}/pending/` with no detection and no
 * tagging. Claude picks it up through the MCP (intake_pending), tags it itself and adds it, so no paid call runs.
 */
export async function uploadForClaude(userId: string, photo: PreparedPhoto, index: number): Promise<string> {
  const path = `${userId}/pending/${Date.now()}-${index}.jpg`;
  await upload("cutouts", path, photo.uri);
  return path;
}

/** One photo waiting in `cutouts/{uid}/pending/`. `uploadedAt` is ISO; null only when neither storage nor the name says. */
export type PendingPhoto = { path: string; url: string; uploadedAt: string | null };
export type PendingListResult = { ok: true; photos: PendingPhoto[] } | { ok: false; reason: string };

// don't touch / same folder, extension filter and page size as intakePending in supabase/functions/mcp/photos.ts, so
// the app counts exactly the photos Claude will be shown. The list also returns the folder placeholder object.
const PENDING_IMAGE = /\.(jpe?g|png|webp)$/i;
const PENDING_LIMIT = 100;
/** `<epoch ms>-<index>.jpg` from uploadForClaude, or `<epoch ms>-requeued.jpg` from the MCP's item_recrop. */
const PENDING_STAMP = /^(\d{12,})-/;

/**
 * The photos parked for Claude (uploadForClaude), newest first, with public URLs. A read: allowed in the design
 * preview too, because the `cutouts` bucket is publicly readable (0001_init.sql "cutouts public read").
 * Newest first is requested from storage, not only sorted here, so a queue over the page size still shows what was
 * just sent. Never throws: a storage error with an HTTP status is `http_<status>`, anything else `network`.
 * @param userId - the folder owner; the list is `<userId>/pending`.
 */
export async function listPendingForClaude(userId: string): Promise<PendingListResult> {
  const folder = `${userId}/pending`;
  try {
    const { data, error } = await supabase.storage
      .from("cutouts")
      .list(folder, { limit: PENDING_LIMIT, sortBy: { column: "created_at", order: "desc" } });
    if (error) {
      const reason = reasonOf(error);
      return { ok: false, reason: reason === "upload" ? "network" : reason };
    }
    const photos = (data ?? [])
      .filter((f) => PENDING_IMAGE.test(f.name))
      .map((f): PendingPhoto => {
        const path = `${folder}/${f.name}`;
        const stamp = PENDING_STAMP.exec(f.name)?.[1];
        // Normalised to toISOString(): storage answers with a `+00:00` offset, and the sort below compares text.
        const stored = f.created_at ? Date.parse(f.created_at) : NaN;
        const ms = Number.isFinite(stored) ? stored : stamp ? Number(stamp) : NaN;
        const uploadedAt = Number.isFinite(ms) ? new Date(ms).toISOString() : null;
        return { path, url: supabase.storage.from("cutouts").getPublicUrl(path).data.publicUrl, uploadedAt };
      })
      // Unknown times go last; ISO strings in UTC compare correctly as text.
      .sort((a, b) => (b.uploadedAt ?? "").localeCompare(a.uploadedAt ?? ""));
    return { ok: true, photos };
  } catch (error) {
    console.error("Listing pending photos failed", error);
    return { ok: false, reason: "network" };
  }
}

/** Uploads a prepared photo to the private `originals` bucket under the user's folder; returns its path. */
export async function uploadOriginal(userId: string, photo: PreparedPhoto, index: number): Promise<string> {
  const path = `${userId}/${Date.now()}-${index}.jpg`;
  await upload("originals", path, photo.uri);
  return path;
}

/**
 * Crops one detected garment out of the real photo and uploads it to the public `cutouts` bucket. The pixels are
 * the user's own photo; only "improve with AI" ever redraws them. Returns the stored path and its public URL.
 */
export async function cropGarment(userId: string, photo: PreparedPhoto, photoId: string, n: number, garment: DetectedGarment) {
  const [ymin, xmin, ymax, xmax] = garment.box;
  const pad = BOX_PADDING * 1000;
  const x0 = Math.max(0, Math.floor(((xmin - pad) / 1000) * photo.width));
  const y0 = Math.max(0, Math.floor(((ymin - pad) / 1000) * photo.height));
  const x1 = Math.min(photo.width, Math.ceil(((xmax + pad) / 1000) * photo.width));
  const y1 = Math.min(photo.height, Math.ceil(((ymax + pad) / 1000) * photo.height));
  const image = await ImageManipulator.manipulate(photo.uri)
    .crop({ originX: x0, originY: y0, width: Math.max(1, x1 - x0), height: Math.max(1, y1 - y0) })
    .renderAsync();
  const saved = await image.saveAsync({ format: SaveFormat.JPEG, compress: 0.9 });
  const path = `${userId}/intake/${photoId}/${n}.jpg`;
  await upload("cutouts", path, saved.uri);
  return { path, url: supabase.storage.from("cutouts").getPublicUrl(path).data.publicUrl };
}

/**
 * Single-garment mode: the whole photo is the garment, so detection (and its mistakes) is skipped. Uploads the
 * full frame as crop 1 and returns it like a detected garment with no issues.
 */
export async function wholePhotoGarment(userId: string, photo: PreparedPhoto, photoId: string) {
  const path = `${userId}/intake/${photoId}/1.jpg`;
  await upload("cutouts", path, photo.uri);
  return { path, url: supabase.storage.from("cutouts").getPublicUrl(path).data.publicUrl };
}

/** Uploads a care-label photo next to the garment's crop; intake-tag reads the composition off it. */
export async function uploadLabel(userId: string, photo: PreparedPhoto, cutoutPath: string): Promise<string> {
  const path = cutoutPath.replace(/\.[^.]+$/, `-label-${Date.now()}.jpg`);
  if (!path.startsWith(`${userId}/`)) throw new Error("label path outside the user's folder");
  await upload("cutouts", path, photo.uri);
  return path;
}

/** The reason carried for an HTTP failure whose body held no reason of its own; the screen shows the status. */
export const httpReason = (status: number): string => `http_${status}`;

/**
 * The failure reason for something thrown by an upload or a write, so the screen can say what happened instead of
 * one generic line. A blocked preview write is "preview"; a storage or database error that carries an HTTP status
 * keeps it (`http_413`); anything else is "upload".
 */
export function reasonOf(error: unknown): string {
  if (error instanceof PreviewReadOnlyError) return "preview";
  if (typeof error === "object" && error !== null) {
    const status = "status" in error ? error.status : "statusCode" in error ? error.statusCode : undefined;
    const n = typeof status === "string" ? Number(status) : status;
    if (typeof n === "number" && Number.isInteger(n) && n >= 400 && n <= 599) return httpReason(n);
  }
  return "upload";
}

/** A server answer that failed the strict schema can still name its reason (a gateway or validation error). */
function reasonFromBody(body: unknown): string | null {
  if (typeof body !== "object" || body === null || !("reason" in body)) return null;
  return typeof body.reason === "string" && body.reason.length > 0 ? body.reason : null;
}

/**
 * Calls an intake Edge Function and parses the answer, turning HTTP errors (cap, bad input) into typed results too.
 * Reasons: the server's own when the body has one, `http_<status>` for an HTTP error without one, "network" when the
 * request never got an answer, "bad_response" for an answer that does not parse.
 */
async function invoke<T extends { ok: boolean }>(
  body: object,
  schema: z.ZodType<T>,
  fn: "intake-separate" | "intake-tag" | "intake-cutout" = "intake-separate"
): Promise<T | { ok: false; reason: string }> {
  // Design preview: no Edge Function call, paid or not. "preview" has its own line in intake.reason.
  if (isPreview()) return { ok: false, reason: "preview" };
  try {
    const { data, error } = await supabase.functions.invoke(fn, { body });
    if (error) {
      if (error instanceof FunctionsHttpError) {
        const body: unknown = await error.context.json().catch(() => null);
        const parsed = schema.safeParse(body);
        if (parsed.success) return parsed.data;
        return { ok: false, reason: reasonFromBody(body) ?? httpReason(error.context.status) };
      }
      return { ok: false, reason: "network" };
    }
    const parsed = schema.safeParse(data);
    return parsed.success ? parsed.data : { ok: false, reason: "bad_response" };
  } catch (error) {
    // Still "network" for the screen (the call never completed), but the cause stays in the console.
    console.error(`${fn} call failed`, error);
    return { ok: false, reason: "network" };
  }
}

/** Detection: boxes, categories, descriptions and problems for one uploaded photo. `single`: the main garment only. Never throws. */
export function detectPhoto(originalPath: string, single = false): Promise<IntakeDetectResult> {
  return invoke({ action: "detect", original_path: originalPath, single }, IntakeDetectResultSchema) as Promise<IntakeDetectResult>;
}

/**
 * Optional, paid: redraws one crop as a complete, clean product photo from the composer's spec (the server builds
 * the prompt from it, the same one the composer previews). Answers reason "billing_required" while the Gemini
 * project is on the free tier; the crop is then kept as it is. Never throws.
 */
export function enhanceCutout(cutoutPath: string, spec: RedrawSpec): Promise<IntakeEnhanceResult> {
  return invoke({ action: "enhance", cutout_path: cutoutPath, spec }, IntakeEnhanceResultSchema) as Promise<IntakeEnhanceResult>;
}

/**
 * Background removal for one crop (Modal worker). Answers reason "not_configured" until the worker is deployed;
 * the app then simply keeps the crop. Never throws.
 */
export function removeBackground(cutoutPath: string): Promise<IntakeCutoutResult> {
  return invoke({ cutout_path: cutoutPath }, IntakeCutoutResultSchema, "intake-cutout") as Promise<IntakeCutoutResult>;
}

/** Proposes the full tags for one crop (Claude). `labelPath` adds a care-label photo for the real composition. */
export function tagCutout(cutoutPath: string, hint: string, labelPath?: string): Promise<IntakeTagResult> {
  const body = { cutout_path: cutoutPath, hint, ...(labelPath ? { label_path: labelPath } : {}) };
  return invoke(body, IntakeTagResultSchema, "intake-tag") as Promise<IntakeTagResult>;
}

/** The fields the review screen lets the user change, and that tag_corrections compares. */
export const REVIEW_FIELDS = ["name", "subcategory", "color_name", "pattern", "material", "fit"] as const;
export type ReviewField = (typeof REVIEW_FIELDS)[number];

/** A flat view of the reviewable fields, as stored in tag_corrections.proposed / final. */
export function reviewValues(name: string, tags: ItemTags): Record<ReviewField, string> {
  return { name, subcategory: tags.subcategory, color_name: tags.color_name, pattern: tags.pattern, material: tags.material, fit: tags.fit };
}

/**
 * Saves a confirmed garment to the wardrobe and records what the tagger got wrong. The external id is derived
 * from the crop path, so saving the same garment twice updates it instead of duplicating it.
 * Throws on a failed item write. A failed correction write does not throw (the item matters, the stat does not):
 * it is logged and reported as `correctionSaved: false`, so the screen can say so quietly.
 */
export async function saveGarment(args: {
  userId: string;
  cutoutPath: string;
  /** Crop path the external id is derived from; stays the same whether the image saved is the crop, cutout or redraw. */
  sourcePath: string;
  thumbPath: string | null;
  name: string;
  brand: string | null;
  tags: ItemTags;
  proposal: TagProposal | null;
  model: string | null;
  /** The composer's spec when the saved image is a redraw, so a later redraw of this item starts from it. */
  redrawSpec?: RedrawSpec | null;
}): Promise<{ id: string; correctionSaved: boolean }> {
  if (isPreview()) throw new PreviewReadOnlyError("saveGarment");
  const externalId = `photo:${args.sourcePath.split("/").slice(-2).join("/")}`;
  const row = itemToInsertRow(
    {
      id: externalId,
      name: args.name,
      brand: args.brand,
      tags: args.tags,
      status: "active",
      availability: "home",
      source: "photo",
      price: null,
      currency: null,
      purchased_at: null,
      cutout_path: args.cutoutPath,
      notes: null,
    },
    args.userId
  );
  const { data, error } = await supabase
    .from("items")
    .upsert({ ...row, thumb_path: args.thumbPath, ...(args.redrawSpec ? { redraw_spec: args.redrawSpec } : {}) }, { onConflict: "user_id,external_id" })
    .select("id")
    .single();
  if (error) throw error;
  let correctionSaved = true;
  if (args.proposal && args.model) {
    const proposed = reviewValues(args.proposal.name, args.proposal.tags);
    const final = reviewValues(args.name, args.tags);
    const changed = REVIEW_FIELDS.filter((f) => proposed[f] !== final[f]);
    const res = await supabase
      .from("tag_corrections")
      .insert({ user_id: args.userId, item_id: data.id, model: args.model, proposed, final, changed });
    if (res.error) {
      console.error("tag correction not saved", res.error.message);
      correctionSaved = false;
    }
  }
  return { id: data.id as string, correctionSaved };
}

/**
 * The plain crop an item's image came from, so a redraw always starts from the real photo rather than from an
 * earlier redraw or cutout. Image paths are `<dir>/<n>.jpg` plus suffixes (`-cutout.png`, `-enhanced.png`,
 * `-enhanced-<ts>.png`, ...). Null for anything that does not follow that shape.
 */
export function sourceCropPath(path: string | null): string | null {
  if (!path) return null;
  const m = path.match(/^(.*\/)(\d+)(?:-[^/]*)?\.(?:jpe?g|png)$/);
  return m ? `${m[1]}${m[2]}.jpg` : null;
}
