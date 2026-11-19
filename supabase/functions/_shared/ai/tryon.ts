import type { Slot } from "@fit-check/schema/stylist.ts";
import { toBase64 } from "./gemini.ts";
import type { AiLogEntry } from "./types.ts";

/**
 * The try-on image model (DESIGN.md "שלב 5.3", docs/REDESIGN_PLAN.md "Try-on"): Nano Banana 2.1.
 * Confirmed 2026-11-19 on Google's own pages: the id on https://aistudio.google.com/docs/models, the price on
 * https://aistudio.google.com/docs/pricing, 10 object + 4 character references and 4:5 at 928x1152 for 1K on
 * https://aistudio.google.com/docs/image-generation. Never called from this code base yet.
 * don't touch / not the redraw's Lite model: Google documents it as "not optimized for multiple reference inputs",
 * and this call sends the figure plus up to four garments.
 */
export const TRYON_MODEL = "gemini-nano-banana-2.1";

/**
 * USD, paid tier (pricing page, 2026-11-19): input $1.50 per 1M tokens (text/image), text and thinking output
 * $7.50 per 1M, image output $30 per 1M where a 1K image is 1120 tokens ($0.0336).
 */
export const TRYON_PRICE = {
  input_token: 1.5 / 1_000_000,
  text_output_token: 7.5 / 1_000_000,
  image_output_token: 30 / 1_000_000,
  image_tokens_1k: 1120,
} as const;

/**
 * Assumptions behind the price shown before a press, all on the high side because the cap must hold:
 * - an input image costs at most 1120 tokens (Google's pages give 258 per 768px tile; a garment cutout of up to
 *   ~1500px is at most 4 tiles = 1032 tokens). Not stated for this model; unconfirmed.
 * - the prompt is under 1000 tokens (it is about 600 words of English at most).
 * - the model may think before drawing; thinking is billed as text output, and 1500 tokens are allowed for it.
 *   Whether this model thinks at all is not documented on the pages read.
 */
const ASSUMED = { tokens_per_input_image: 1120, prompt_tokens: 1000, thinking_tokens: 1500 } as const;

/** Estimated USD for one generation with `inputImages` reference images (unrounded). */
function estimate(inputImages: number): number {
  return (
    TRYON_PRICE.image_tokens_1k * TRYON_PRICE.image_output_token +
    (inputImages * ASSUMED.tokens_per_input_image + ASSUMED.prompt_tokens) * TRYON_PRICE.input_token +
    ASSUMED.thinking_tokens * TRYON_PRICE.text_output_token
  );
}

/**
 * What one outfit image costs, rounded up to the tenth of a cent like ENHANCE_PRICE_USD, for the largest outfit
 * (figure + 4 garments = 5 input images). This is both the number the sheet shows and the number the cap checks.
 * don't touch / it is about $0.055, not the $0.034 in DESIGN.md "שלב 5.3": that figure is the output image alone.
 */
export const TRYON_PRICE_USD = Math.ceil(estimate(5) * 1000) / 1000;
/** The one-time figure: no input image, same output. */
export const FIGURE_PRICE_USD = Math.ceil(estimate(0) * 1000) / 1000;

/** The figure's version; part of the cache key and the stored path. Bump it when FIGURE_PROMPT changes. */
export const FIGURE_VERSION = "v1";

/**
 * One generation may take 10-30 s (spec). 90 s leaves room for five reference images and a busy provider, and stays
 * under the Edge runtime's 150 s request limit so the function can still answer and log.
 */
export const TRYON_TIMEOUT_MS = 90_000;

/** The app's `tile` token (DESIGN.md section 2): the figure and every render sit on it, like the garment tiles. */
const TILE_HEX = "#EDE7DB";

/**
 * A button-down is tucked in only at this formality or above (1-10 tag, the same scale as the sheet). 7 is where
 * the engine's Shabbat and holiday band starts (`DEFAULT_CONTEXT_RULES` in packages/engine/src/config.ts), i.e. the
 * dress shirts Roy wears to synagogue; a casual button-down below that is worn out, like every other top.
 */
export const TUCK_FORMALITY_MIN = 7;

/**
 * The fixed figure. Neutral base clothing: a plain, fitted, light grey short-sleeve crew-neck T-shirt and plain
 * slim light grey trousers, grey socks, no shoes. Chosen so nothing of it can survive into a render as a detail:
 * one flat tone, no collar, buttons, pattern or logo, close to the body so any garment covers it, and short sleeves
 * so a short-sleeve garment never shows a grey sleeve below it. No shoes, so the outfit's shoes are always added,
 * never mixed with a drawn pair.
 */
export const FIGURE_PROMPT = [
  "Draw one adult man standing upright, front view, full body from the top of the head to the feet, arms relaxed at his sides, feet slightly apart.",
  "Average build. The face is a smooth blank oval with no facial features at all: no eyes, nose, mouth or hair detail beyond a simple hair outline.",
  "Style: a quiet, flat editorial fashion illustration with thin even ink lines and soft flat colour fills, no shading gradients, no texture, no shadow.",
  "He wears neutral base clothing only: a plain fitted light grey short-sleeve crew-neck T-shirt, plain slim light grey trousers and plain grey socks, no shoes.",
  "No logo, text, pattern, jewellery, watch, belt, bag or any accessory.",
  `Background: one plain flat colour ${TILE_HEX}, no floor line, no shadow, no frame. Centre the figure with a small margin above the head and below the feet.`,
].join(" ");

/** One garment as the function reads it from `items` (hot columns) plus its stored image. */
export interface TryonGarment {
  slot: Slot;
  subcategory: string;
  color_name: string;
  color_hex: string;
  pattern: string;
  material: string;
  formality: number;
  image: Uint8Array;
  mimeType: string;
}

export interface TryonImage {
  image: Uint8Array;
  mimeType: string;
}

export type TryonFailure = "provider_refused" | "provider_timeout" | "provider_error";

/**
 * `providerCalled` false means no request reached Google (no key); the caller then has nothing to log.
 * The log is always present so a caller cannot forget to write the row when the provider was called.
 */
export type TryonResult =
  | { ok: true; image: Uint8Array; mimeType: string; log: AiLogEntry }
  | { ok: false; error: TryonFailure; providerCalled: boolean; log: AiLogEntry };

/** Outfit order in the prompt and in the images: what is worn underneath before what goes over it, shoes last. */
const SLOT_ORDER: readonly Slot[] = ["top", "layer", "bottom", "shoes"];
const SLOT_NAME: Record<Slot, string> = { top: "top (shirt)", layer: "layer (worn over the top)", bottom: "trousers", shoes: "shoes" };

const words = (s: string) => s.replace(/_/g, " ");

/** Garments in prompt order. Exported so the handler sends the images in the same order the prompt names them. */
export function orderGarments<T extends { slot: Slot }>(garments: readonly T[]): T[] {
  return [...garments].sort((a, b) => SLOT_ORDER.indexOf(a.slot) - SLOT_ORDER.indexOf(b.slot));
}

/** True when this outfit's top goes into the trousers (see TUCK_FORMALITY_MIN). */
export function tuckedIn(garments: readonly Pick<TryonGarment, "slot" | "subcategory" | "formality">[]): boolean {
  const top = garments.find((g) => g.slot === "top");
  return top !== undefined && top.subcategory === "button_down" && top.formality >= TUCK_FORMALITY_MIN;
}

/**
 * The outfit prompt. Image 1 is the figure; images 2.. are the garments in `orderGarments` order. Garments are named
 * by slot and tags only, never by the item's name: a name often holds a brand, and a brand in the prompt invites
 * the model to letter it onto the garment.
 */
export function buildTryonPrompt(garments: readonly Omit<TryonGarment, "image" | "mimeType">[]): string {
  const ordered = orderGarments(garments);
  const list = ordered
    .map((g, i) => `Image ${i + 2}: the ${SLOT_NAME[g.slot]}: ${words(g.color_name)} ${words(g.pattern)} ${words(g.material)} ${words(g.subcategory)}, main colour ${g.color_hex}.`)
    .join(" ");
  const hasLayer = ordered.some((g) => g.slot === "layer");
  return [
    "Image 1 is a drawn figure. Dress this exact figure in the garments shown in the following images, and output one image.",
    "Keep the figure exactly as it is: the same person, proportions, pose, blank face, framing, drawing style and background.",
    list,
    "Each garment must keep its exact colour, pattern, stripes, print, texture, buttons, collar and any logo exactly as in its photo, at a believable size on the body. Do not redesign, recolour or simplify any garment.",
    "The garments replace the figure's grey base clothing completely; no grey T-shirt, trousers or socks may show anywhere.",
    hasLayer ? "The layer is worn over the top, so the top shows only where the layer leaves it visible." : "",
    tuckedIn(ordered) ? "The shirt is tucked into the trousers." : "The top is worn untucked, hanging outside the trousers.",
    "Add nothing that is not in the images: no other garment, no accessory, belt, bag, hat, watch, jewellery, and no text, letters or labels anywhere.",
    `Show the whole figure from head to shoes, centred, on a plain flat ${TILE_HEX} background with no floor line and no shadow.`,
  ]
    .filter((s) => s.length > 0)
    .join(" ");
}

type Part = { text: string } | { inline_data: { mime_type: string; data: string } };

type GeminiImageResponse = {
  candidates?: Array<{ content?: { parts?: Array<{ text?: string; inlineData?: { mimeType?: string; data?: string } }> }; finishReason?: string }>;
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    thoughtsTokenCount?: number;
    candidatesTokensDetails?: Array<{ modality?: string; tokenCount?: number }>;
  };
  promptFeedback?: { blockReason?: string };
};

/** finishReason values that mean the model declined (generateContent reference, Candidate.FinishReason). */
const REFUSAL_REASONS = new Set(["SAFETY", "PROHIBITED_CONTENT", "BLOCKLIST", "SPII", "IMAGE_SAFETY", "IMAGE_PROHIBITED_CONTENT", "RECITATION", "IMAGE_RECITATION"]);

/** Actual cost from the usage the provider reports; image output tokens priced as images, the rest as text. */
function costOf(body: GeminiImageResponse, fallbackUsd: number): { cost: number; input_tokens: number; output_tokens: number } {
  const u = body.usageMetadata;
  if (!u) return { cost: fallbackUsd, input_tokens: 0, output_tokens: 0 };
  const input = u.promptTokenCount ?? 0;
  const candidates = u.candidatesTokenCount ?? 0;
  const imageTokens = (u.candidatesTokensDetails ?? []).filter((d) => d.modality === "IMAGE").reduce((s, d) => s + (d.tokenCount ?? 0), 0);
  const textTokens = Math.max(0, candidates - imageTokens) + (u.thoughtsTokenCount ?? 0);
  const cost = input * TRYON_PRICE.input_token + imageTokens * TRYON_PRICE.image_output_token + textTokens * TRYON_PRICE.text_output_token;
  // When Google gives no per-modality split, an image that came back is priced as the documented 1120 tokens rather
  // than as text: under-counting would let the cap drift.
  const imageFloor = imageTokens === 0 && body.candidates?.[0]?.content?.parts?.some((p) => p.inlineData?.data) ? TRYON_PRICE.image_tokens_1k * TRYON_PRICE.image_output_token : 0;
  return { cost: Math.round((cost + imageFloor) * 100_000) / 100_000, input_tokens: input, output_tokens: candidates + (u.thoughtsTokenCount ?? 0) };
}

function fromBase64(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/**
 * One generateContent call to TRYON_MODEL. Never throws.
 * Retry policy: none. A 429, 500 or 503 answers provider_error at once and the user decides whether to press again;
 * an automatic retry after a timeout could pay for a generation that finished on Google's side after we gave up.
 * A timeout is logged at the estimated price (`estimateUsd`), because whether Google billed it cannot be known
 * (the money rule: unknown counts as spent). HTTP errors are logged at 0: Google bills completed generations.
 */
async function generate(parts: Part[], estimateUsd: number, timeoutMs: number): Promise<TryonResult> {
  const started = Date.now();
  const base = { provider: "google" as const, model: TRYON_MODEL, task: "tryon" as const, images: 1 };
  const fail = (error: TryonFailure, detail: string, extra: Partial<AiLogEntry> = {}, providerCalled = true): TryonResult => ({
    ok: false,
    error,
    providerCalled,
    log: { ...base, latency_ms: Date.now() - started, ok: false, cost_usd: 0, error: detail.slice(0, 300), ...extra },
  });

  // don't touch / the same key and Google project as the redraw (gemini.ts): only that project has billing and the
  // AI Pro credit, so this model is covered by the same credit and the same cap.
  const key = Deno.env.get("GEMINI_IMAGE_API_KEY");
  if (!key) return fail("provider_error", "GEMINI_IMAGE_API_KEY is not set", {}, false);

  let res: Response;
  try {
    res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${TRYON_MODEL}:generateContent`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({
        contents: [{ role: "user", parts }],
        // 4:5 is in ImageConfig.aspectRatio's list (generateContent reference) and is the sheet's frame; 1K = 928x1152.
        generationConfig: { responseModalities: ["IMAGE"], imageConfig: { aspectRatio: "4:5", imageSize: "1K" } },
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    const name = error instanceof Error ? error.name : "";
    if (name === "TimeoutError" || name === "AbortError") return fail("provider_timeout", `timeout after ${timeoutMs} ms`, { cost_usd: estimateUsd });
    return fail("provider_error", `network: ${String(error)}`);
  }
  if (!res.ok) return fail("provider_error", `HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);

  let body: GeminiImageResponse;
  try {
    body = (await res.json()) as GeminiImageResponse;
  } catch {
    return fail("provider_error", "response is not JSON", { cost_usd: estimateUsd });
  }
  const { cost, ...usage } = costOf(body, estimateUsd);
  const blocked = body.promptFeedback?.blockReason;
  if (blocked) return fail("provider_refused", `blocked: ${blocked}`, { ...usage, cost_usd: cost });
  const candidate = body.candidates?.[0];
  const part = candidate?.content?.parts?.find((p) => p.inlineData?.data);
  if (!part?.inlineData?.data) {
    const reason = candidate?.finishReason ?? "unknown";
    const said = (candidate?.content?.parts ?? []).map((p) => p.text ?? "").join(" ").trim().slice(0, 120);
    return fail(REFUSAL_REASONS.has(reason) ? "provider_refused" : "provider_error", `no image (${reason})${said ? `: ${said}` : ""}`, { ...usage, cost_usd: cost });
  }
  return {
    ok: true,
    image: fromBase64(part.inlineData.data),
    mimeType: part.inlineData.mimeType ?? "image/png",
    log: { ...base, latency_ms: Date.now() - started, ok: true, cost_usd: cost, ...usage },
  };
}

/**
 * Draws the outfit on the figure: one image, 4:5, 1K. Never throws.
 * Inputs: the stored figure, and 3-4 garments (the schema's outfit rule) with their wardrobe images.
 * The request carries the prompt, then image 1 (the figure), then each garment in `orderGarments` order, each image
 * preceded by a one-line label so the model ties "image N" to the right picture.
 * Failure modes: no key (provider_error, providerCalled false), network error or HTTP error including 429/500/503
 * (provider_error), timeout (provider_timeout), a prompt block or a safety finish reason (provider_refused), any
 * other answer without an image (provider_error). The caller writes `log` to ai_calls whenever `providerCalled`.
 */
export function renderOutfit(garments: readonly TryonGarment[], figure: TryonImage, timeoutMs = TRYON_TIMEOUT_MS): Promise<TryonResult> {
  const ordered = orderGarments(garments);
  const parts: Part[] = [
    { text: buildTryonPrompt(ordered) },
    { text: "Image 1: the figure." },
    { inline_data: { mime_type: figure.mimeType, data: toBase64(figure.image) } },
  ];
  ordered.forEach((g, i) => {
    parts.push({ text: `Image ${i + 2}: the ${SLOT_NAME[g.slot]}.` });
    parts.push({ inline_data: { mime_type: g.mimeType, data: toBase64(g.image) } });
  });
  return generate(parts, Math.ceil(estimate(1 + ordered.length) * 100_000) / 100_000, timeoutMs);
}

/**
 * Draws the one-time default figure (FIGURE_PROMPT, version FIGURE_VERSION). Never throws; same failure modes and
 * log contract as renderOutfit. No photo of anyone is sent: the figure is made from text alone.
 */
export function renderFigure(timeoutMs = TRYON_TIMEOUT_MS): Promise<TryonResult> {
  return generate([{ text: FIGURE_PROMPT }], Math.ceil(estimate(0) * 100_000) / 100_000, timeoutMs);
}
