import {
  IntakeDetectResultSchema,
  IntakeEnhanceResultSchema,
  IntakeTagResultSchema,
  itemToInsertRow,
  type DetectedGarment,
  type IntakeDetectResult,
  type IntakeEnhanceResult,
  type IntakeTagResult,
  type ItemTags,
  type TagProposal,
} from "@fit-check/schema";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import { FunctionsHttpError } from "@supabase/supabase-js";
import type { z } from "zod";
import { supabase } from "../lib/supabase";

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
  const bytes = await (await fetch(uri)).arrayBuffer();
  const { error } = await supabase.storage.from(bucket).upload(path, bytes, { contentType: "image/jpeg" });
  if (error) throw error;
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

/** Calls an intake Edge Function and parses the answer, turning HTTP errors (cap, bad input) into typed results too. */
async function invoke<T extends { ok: boolean }>(
  body: object,
  schema: z.ZodType<T>,
  fn: "intake-separate" | "intake-tag" = "intake-separate"
): Promise<T | { ok: false; reason: string }> {
  try {
    const { data, error } = await supabase.functions.invoke(fn, { body });
    if (error) {
      if (error instanceof FunctionsHttpError) {
        const parsed = schema.safeParse(await error.context.json().catch(() => null));
        if (parsed.success) return parsed.data;
      }
      return { ok: false, reason: "network" };
    }
    const parsed = schema.safeParse(data);
    return parsed.success ? parsed.data : { ok: false, reason: "bad_response" };
  } catch {
    return { ok: false, reason: "network" };
  }
}

/** Detection: boxes, categories, descriptions and problems for one uploaded photo. `single`: the main garment only. Never throws. */
export function detectPhoto(originalPath: string, single = false): Promise<IntakeDetectResult> {
  return invoke({ action: "detect", original_path: originalPath, single }, IntakeDetectResultSchema) as Promise<IntakeDetectResult>;
}

/**
 * Optional, paid: redraws one crop as a complete, clean product photo. Answers reason "billing_required" while the
 * Gemini project is on the free tier; the crop is then kept as it is. Never throws.
 */
export function enhanceCutout(cutoutPath: string, description: string): Promise<IntakeEnhanceResult> {
  return invoke({ action: "enhance", cutout_path: cutoutPath, description }, IntakeEnhanceResultSchema) as Promise<IntakeEnhanceResult>;
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
 * The redraw prompt's garment description, from the confirmed tags rather than detection's guess: a wrong
 * description makes the image model draw the wrong cloth (melange tailored trousers came back as olive chinos).
 */
export function describeForRedraw(tags: ItemTags): string {
  const pattern = tags.pattern === "solid" ? "" : `${tags.pattern} `;
  const material = tags.material === "unknown" || tags.material === "mixed" ? "" : `${tags.material} `;
  return `${tags.color_name.replace("_", " ")} ${pattern}${material}${tags.subcategory.replace("_", " ")} (main colour ${tags.color_hex})`;
}

/**
 * Saves a confirmed garment to the wardrobe and records what the tagger got wrong. The external id is derived
 * from the crop path, so saving the same garment twice updates it instead of duplicating it.
 * Throws on a failed item write; a failed correction write is only logged (the item matters, the stat does not).
 */
export async function saveGarment(args: {
  userId: string;
  cutoutPath: string;
  name: string;
  brand: string | null;
  tags: ItemTags;
  proposal: TagProposal | null;
  model: string | null;
}): Promise<string> {
  const externalId = `photo:${args.cutoutPath.split("/").slice(-2).join("/")}`;
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
  const { data, error } = await supabase.from("items").upsert(row, { onConflict: "user_id,external_id" }).select("id").single();
  if (error) throw error;
  if (args.proposal && args.model) {
    const proposed = reviewValues(args.proposal.name, args.proposal.tags);
    const final = reviewValues(args.name, args.tags);
    const changed = REVIEW_FIELDS.filter((f) => proposed[f] !== final[f]);
    const res = await supabase
      .from("tag_corrections")
      .insert({ user_id: args.userId, item_id: data.id, model: args.model, proposed, final, changed });
    if (res.error) console.error("tag correction not saved", res.error.message);
  }
  return data.id as string;
}
