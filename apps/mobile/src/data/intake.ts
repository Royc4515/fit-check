import { IntakeEnhanceResultSchema, IntakeSeparateResultSchema, type IntakeEnhanceResult, type IntakeSeparateResult } from "@fit-check/schema";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import { FunctionsHttpError } from "@supabase/supabase-js";
import { supabase } from "../lib/supabase";

/**
 * Long edge of the photo sent for separation. The image model works at 1024px; 1600 leaves room for the garment
 * listing to see small details (logos, collars) while keeping uploads around 300-500KB instead of 4-8MB.
 */
const MAX_EDGE = 1600;

/** Downscales and re-encodes a picked photo to JPEG. Also strips the HEIC and EXIF variety phones produce. */
export async function preparePhoto(uri: string, width: number, height: number): Promise<string> {
  const scale = Math.min(1, MAX_EDGE / Math.max(width, height || 1));
  const context = ImageManipulator.manipulate(uri);
  if (scale < 1) context.resize({ width: Math.round(width * scale), height: Math.round(height * scale) });
  const image = await context.renderAsync();
  const saved = await image.saveAsync({ format: SaveFormat.JPEG, compress: 0.85 });
  return saved.uri;
}

/**
 * Uploads a prepared photo to the private `originals` bucket under the user's folder and returns its path.
 * ArrayBuffer, not Blob: supabase-js on React Native cannot upload a Blob read from a file:// URI.
 */
export async function uploadOriginal(userId: string, uri: string, index: number): Promise<string> {
  const bytes = await (await fetch(uri)).arrayBuffer();
  const path = `${userId}/${Date.now()}-${index}.jpg`;
  const { error } = await supabase.storage.from("originals").upload(path, bytes, { contentType: "image/jpeg" });
  if (error) throw error;
  return path;
}

/**
 * Asks intake-separate to cut the garments out of one uploaded photo. Never throws: every outcome, including HTTP
 * errors from the function (daily cap, bad input), comes back as a typed result the screen can word.
 */
export async function separatePhoto(originalPath: string): Promise<IntakeSeparateResult> {
  try {
    const { data, error } = await supabase.functions.invoke("intake-separate", { body: { action: "separate", original_path: originalPath } });
    if (error) {
      if (error instanceof FunctionsHttpError) {
        const parsed = IntakeSeparateResultSchema.safeParse(await error.context.json().catch(() => null));
        if (parsed.success) return parsed.data;
      }
      return { ok: false, reason: "network" };
    }
    const parsed = IntakeSeparateResultSchema.safeParse(data);
    return parsed.success ? parsed.data : { ok: false, reason: "bad_response" };
  } catch {
    return { ok: false, reason: "network" };
  }
}

/**
 * Optional, paid: redraws one cutout as a clean product photo. Returns reason "billing_required" while the Gemini
 * project is on the free tier; the free cutout is then kept as it is. Never throws.
 */
export async function enhanceCutout(cutoutPath: string, description: string): Promise<IntakeEnhanceResult> {
  try {
    const { data, error } = await supabase.functions.invoke("intake-separate", {
      body: { action: "enhance", cutout_path: cutoutPath, description },
    });
    if (error) {
      if (error instanceof FunctionsHttpError) {
        const parsed = IntakeEnhanceResultSchema.safeParse(await error.context.json().catch(() => null));
        if (parsed.success) return parsed.data;
      }
      return { ok: false, reason: "network" };
    }
    const parsed = IntakeEnhanceResultSchema.safeParse(data);
    return parsed.success ? parsed.data : { ok: false, reason: "bad_response" };
  } catch {
    return { ok: false, reason: "network" };
  }
}
