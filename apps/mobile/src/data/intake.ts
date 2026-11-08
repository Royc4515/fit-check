import { IntakeDetectResultSchema, IntakeEnhanceResultSchema, type DetectedGarment, type IntakeDetectResult, type IntakeEnhanceResult } from "@fit-check/schema";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import { FunctionsHttpError } from "@supabase/supabase-js";
import type { z } from "zod";
import { supabase } from "../lib/supabase";

/**
 * Long edge of the photo sent for detection and cropped from. 1600 keeps small details (logos, collars) for the
 * crops while uploads stay around 300-500KB instead of 4-8MB.
 */
const MAX_EDGE = 1600;
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

/** Calls intake-separate and parses the answer, turning HTTP errors (cap, bad input) into typed results too. */
async function invoke<T extends { ok: boolean }>(body: object, schema: z.ZodType<T>): Promise<T | { ok: false; reason: string }> {
  try {
    const { data, error } = await supabase.functions.invoke("intake-separate", { body });
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

/** Free detection: boxes, categories, descriptions and problems for one uploaded photo. Never throws. */
export function detectPhoto(originalPath: string): Promise<IntakeDetectResult> {
  return invoke({ action: "detect", original_path: originalPath }, IntakeDetectResultSchema) as Promise<IntakeDetectResult>;
}

/**
 * Optional, paid: redraws one crop as a complete, clean product photo. Answers reason "billing_required" while the
 * Gemini project is on the free tier; the crop is then kept as it is. Never throws.
 */
export function enhanceCutout(cutoutPath: string, description: string): Promise<IntakeEnhanceResult> {
  return invoke({ action: "enhance", cutout_path: cutoutPath, description }, IntakeEnhanceResultSchema) as Promise<IntakeEnhanceResult>;
}
