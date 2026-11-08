import { Image } from "imagescript";

/** Gemini boxes are [ymin, xmin, ymax, xmax] normalised to 0..1000. */
export type Box = [number, number, number, number];

/** Below this many pixels on a side a cutout is noise, not a garment. */
const MIN_SIDE_PX = 24;

/**
 * Maps the mask's probability (0..255) to alpha with a short ramp instead of a hard threshold: a hard cut leaves
 * jagged stair-steps on knit edges, a plain copy leaves a grey halo of bed sheet around the garment.
 */
function alphaFor(probability: number): number {
  if (probability < 96) return 0;
  if (probability > 160) return 255;
  return (probability - 96) * 4;
}

/**
 * Cuts one garment out of the photo: crop to the box, scale the mask to the crop, use it as the alpha channel.
 * The pixels are the real photo, never regenerated. Returns null for a box that is degenerate or off the image.
 * Works on the raw RGBA bitmap (not getPixelAt/setPixelAt): the per-call overhead of those blew most of the
 * Edge Function CPU budget on a 1600px photo.
 */
export async function cutOut(photo: Image, box: Box, maskPng: Uint8Array): Promise<Uint8Array | null> {
  const [ymin, xmin, ymax, xmax] = box;
  const x0 = Math.max(0, Math.round((xmin / 1000) * photo.width));
  const y0 = Math.max(0, Math.round((ymin / 1000) * photo.height));
  const x1 = Math.min(photo.width, Math.round((xmax / 1000) * photo.width));
  const y1 = Math.min(photo.height, Math.round((ymax / 1000) * photo.height));
  const w = x1 - x0;
  const h = y1 - y0;
  if (w < MIN_SIDE_PX || h < MIN_SIDE_PX) return null;

  const crop = photo.clone().crop(x0, y0, w, h);
  const mask = (await Image.decode(maskPng)) as Image;
  mask.resize(w, h);

  const px = crop.bitmap;
  const m = mask.bitmap;
  let visible = 0;
  for (let i = 0; i < px.length; i += 4) {
    const a = alphaFor(m[i]!);
    px[i + 3] = a;
    if (a > 0) visible++;
  }
  // A mask that keeps almost nothing is a failed segmentation; better no cutout than an empty frame.
  if (visible < (w * h) / 50) return null;
  return await crop.encode(1);
}

export async function decodePhoto(bytes: Uint8Array): Promise<Image> {
  return (await Image.decode(bytes)) as Image;
}
