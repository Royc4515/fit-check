/**
 * Makes the plain white background of an AI redraw transparent, right after the image is generated (Roy, 2026-11-18:
 * redraws stayed on white whenever the Modal worker was down; it was disabled that morning). No model, no network:
 * the redraw prompt demands a pure #FFFFFF background, so a flood fill from the image border is enough.
 *
 * How: every near-white pixel connected to the border is background (alpha 0); pixels next to it fade by how close
 * to white they are, which keeps a soft edge. Near-white parts inside the garment (a white logo, a white shirt's
 * placket) are not connected to the border through near-white pixels, so they stay.
 *
 * Returns null, and the caller keeps the white image, when the result looks wrong: almost no background found
 * (the model ignored the white-background instruction) or almost nothing left (a white garment the fill leaked into).
 */

/** A background pixel is this grey at most (max minus min channel). */
const MAX_TINT = 14;
/**
 * Bounds for the adaptive white threshold. Gemini's "white" background sits anywhere from 246 to 255 and a white
 * shirt's lit fabric reaches 242, so a fixed 236 leaked into white shirts (Abercrombie, 2026-11-18). The threshold
 * is read from the image's own border instead: just under its darkest typical border pixel.
 */
const THRESHOLD_MIN = 238;
const THRESHOLD_MAX = 250;
/** Edge pixels fade to opaque over this many levels below the threshold. */
const EDGE_RAMP = 30;
/** Sanity bounds on the share of the image that turned transparent. */
const MIN_BG_SHARE = 0.08;
const MAX_BG_SHARE = 0.93;

export async function whiteToTransparent(bytes: Uint8Array): Promise<Uint8Array | null> {
  // don't touch / the Deno build of imagescript (pure WASM), loaded lazily: the npm build's native codec crashed the
  // Edge runtime at boot (mcp v4, 2026-11-17).
  const { decode } = await import("https://deno.land/x/imagescript@1.3.0/mod.ts");
  const img = await decode(bytes);
  if (!("bitmap" in img)) return null;
  const { width: w, height: h } = img;
  const px = img.bitmap; // RGBA, row-major
  const n = w * h;

  const lightness = (i: number) => Math.min(px[i * 4]!, px[i * 4 + 1]!, px[i * 4 + 2]!);
  const greyish = (i: number) => Math.max(px[i * 4]!, px[i * 4 + 1]!, px[i * 4 + 2]!) - lightness(i) <= MAX_TINT;

  // 3rd percentile of the border's lightness: robust to a garment touching the frame in a few places.
  const border: number[] = [];
  for (let x = 0; x < w; x++) border.push(lightness(x), lightness((h - 1) * w + x));
  for (let y = 1; y < h - 1; y++) border.push(lightness(y * w), lightness(y * w + w - 1));
  border.sort((a, b) => a - b);
  const borderLow = border[Math.floor(border.length * 0.03)]!;
  if (borderLow < THRESHOLD_MIN) return null; // the border is not white: nothing safe to remove
  const threshold = Math.min(THRESHOLD_MAX, borderLow - 2);

  const isWhite = (i: number) => lightness(i) >= threshold && greyish(i);

  const bg = new Uint8Array(n);
  const queue = new Int32Array(n);
  let head = 0;
  let tail = 0;
  const seed = (i: number) => {
    if (!bg[i] && isWhite(i)) {
      bg[i] = 1;
      queue[tail++] = i;
    }
  };
  for (let x = 0; x < w; x++) {
    seed(x);
    seed((h - 1) * w + x);
  }
  for (let y = 0; y < h; y++) {
    seed(y * w);
    seed(y * w + w - 1);
  }
  while (head < tail) {
    const i = queue[head++]!;
    const x = i % w;
    if (x > 0) seed(i - 1);
    if (x < w - 1) seed(i + 1);
    if (i >= w) seed(i - w);
    if (i < n - w) seed(i + w);
  }

  const share = tail / n;
  if (share < MIN_BG_SHARE || share > MAX_BG_SHARE) return null;

  let minX = w, minY = h, maxX = -1, maxY = -1;
  for (let i = 0; i < n; i++) {
    if (bg[i]) {
      px[i * 4 + 3] = 0;
      continue;
    }
    const x = i % w;
    const y = (i - x) / w;
    // Edge pixel (touches background): fade by whiteness so the outline does not keep a white fringe.
    const touches = (x > 0 && bg[i - 1]) || (x < w - 1 && bg[i + 1]) || (i >= w && bg[i - w]) || (i < n - w && bg[i + w]);
    if (touches) {
      const alpha = Math.round(((threshold - lightness(i)) / EDGE_RAMP) * 255);
      px[i * 4 + 3] = Math.min(px[i * 4 + 3]!, Math.max(60, Math.min(255, alpha)));
    }
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  if (maxX < 0) return null;
  // Trimmed like the worker's cutouts, so every garment sits on the same baseline in the grid.
  return await img.crop(minX, minY, maxX - minX + 1, maxY - minY + 1).encode(1);
}
