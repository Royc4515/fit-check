import { z } from "zod";
import { CATEGORIES } from "@fit-check/schema/item-tags.ts";
import {
  BoxSchema,
  GARMENT_ISSUES,
  MAX_GARMENTS_PER_PHOTO,
  type DetectedGarment,
  type GarmentIssue,
} from "@fit-check/schema/intake.ts";
import type { AiLogEntry } from "./types.ts";

/**
 * Two Gemini models, by cost (Roy, 2026-11-08: no real money by default; retake first, generation on request):
 * - DETECT_MODEL finds each garment: a box, a category, a description and what is wrong with the shot. Free tier,
 *   so detection costs $0. The app crops the real photo itself; nothing is regenerated.
 * - ENHANCE_MODEL redraws one cropped garment as a clean product photo. No free tier ($0.0336 per image), so it
 *   only runs when the user asks, and answers billing_required while the project has no billing.
 * don't touch / not gemini-2.5-flash: its segmentation masks are being retired (requests move to 3.5 Flash-Lite on
 * 2026-12-01) and 3.x has no masks at all, so the pipeline relies on boxes only.
 */
export const DETECT_MODEL = "gemini-3.8-flash";
export const ENHANCE_MODEL = "gemini-3.1-flash-lite-image";

/** USD, Gemini API paid tier (2026-11): $0.25 per 1M input tokens, $0.0336 per 1024px output image. */
const ENHANCE_PRICE = { input_token: 0.25 / 1_000_000, image: 0.0336 } as const;

const endpoint = (model: string) => `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

const DETECT_PROMPT = [
  "Detect each separate garment in this photo that a man could add to his wardrobe:",
  "tops, trousers, shoes, knits, jackets and accessories. A pair of shoes is one entry. Never include skin, faces or hair.",
  'Output a JSON list. Each entry has "box_2d" ([ymin, xmin, ymax, xmax], normalised to 0-1000, tight around the garment),',
  '"label" (exactly one of: top, bottom, shoes, layer, outerwear, accessory),',
  '"description" (colour and type in English, e.g. "navy crew-neck knit sweater"), and',
  '"issues": a list with any of "occluded" (partly hidden by something), "overlapping" (lies on or under another garment),',
  '"cut_off" (cut by the photo edge), "wrinkled" (heavily creased), "blurry", "dark" (badly lit). Empty list if the garment is clearly shown.',
  `At most ${MAX_GARMENTS_PER_PHOTO} entries, most complete garments first. If there is no garment, output an empty list.`,
].join(" ");

function enhancePrompt(description: string): string {
  return [
    `This is a photo of one garment: ${description}. Parts of it may be hidden, creased, or overlapped by other clothes.`,
    "Render the complete garment as a clean e-commerce product photo: alone, laid flat or as if on an invisible mannequin, front view, centred, filling most of the frame.",
    "Background: plain pure white (#FFFFFF), no shadow, no floor, no hanger, no person, no other clothing or objects.",
    "Keep the exact colour, pattern, fabric texture, buttons, logos and proportions. Complete hidden parts plausibly and smooth creases, but do not restyle it and do not add text.",
  ].join(" ");
}

const DetectEntrySchema = z.object({
  box_2d: BoxSchema,
  label: z.string(),
  description: z.string().optional(),
  issues: z.array(z.string()).optional(),
});

/** The label is asked for as a category but is free text; anything unknown is a top rather than a dropped garment. */
function toCategory(label: string): (typeof CATEGORIES)[number] {
  const l = label.toLowerCase();
  return ((CATEGORIES as readonly string[]).find((c) => l.includes(c)) as (typeof CATEGORIES)[number] | undefined) ?? "top";
}

/** Unknown issue words are dropped: an issue the app cannot word is no help to the user. */
const toIssues = (raw: string[] | undefined): GarmentIssue[] =>
  [...new Set((raw ?? []).filter((i): i is GarmentIssue => (GARMENT_ISSUES as readonly string[]).includes(i)))];

/** A box with no area, or reversed corners, cannot be cropped. */
const usableBox = ([ymin, xmin, ymax, xmax]: [number, number, number, number]) =>
  ymax - ymin >= 20 && xmax - xmin >= 20 && ymin >= 0 && xmin >= 0 && ymax <= 1000 && xmax <= 1000;

export type DetectResult = { garments: DetectedGarment[] | null; log: AiLogEntry };

/**
 * Finds the garments in a photo (step 1 of separateGarments). Never throws.
 * Failure modes: missing key, HTTP error (including free-tier rate limits, 429), safety block, or an answer that is
 * not the expected JSON. Entries that fail validation are dropped individually, not the whole answer.
 */
export async function detectGarments(image: Uint8Array, mimeType: string): Promise<DetectResult> {
  const started = Date.now();
  const base = { provider: "google" as const, model: DETECT_MODEL, task: "separate" as const, images: 1 };
  const fail = (error: string, extra: Partial<AiLogEntry> = {}): DetectResult => ({
    garments: null,
    log: { ...base, latency_ms: Date.now() - started, ok: false, error: error.slice(0, 300), ...extra },
  });
  const key = Deno.env.get("GEMINI_API_KEY");
  if (!key) return fail("GEMINI_API_KEY is not set");

  let res: Response;
  try {
    res = await fetch(endpoint(DETECT_MODEL), {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ inline_data: { mime_type: mimeType, data: toBase64(image) } }, { text: DETECT_PROMPT }] }],
        generationConfig: { responseMimeType: "application/json" },
      }),
      signal: AbortSignal.timeout(90_000),
    });
  } catch (error) {
    return fail(`network: ${String(error)}`);
  }
  if (!res.ok) return fail(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);

  const body = (await res.json()) as GeminiResponse;
  const usage = { input_tokens: body.usageMetadata?.promptTokenCount ?? 0, output_tokens: body.usageMetadata?.candidatesTokenCount ?? 0 };
  if (body.promptFeedback?.blockReason) return fail(`blocked: ${body.promptFeedback.blockReason}`, usage);
  const text = (body.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? "").join("");
  let raw: unknown;
  try {
    // JSON mode usually returns bare JSON; the fence strip covers the occasional markdown-wrapped answer.
    raw = JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, ""));
  } catch {
    return fail("invalid JSON", usage);
  }
  if (!Array.isArray(raw)) return fail("not a list", usage);

  const garments: DetectedGarment[] = [];
  for (const entry of raw) {
    const parsed = DetectEntrySchema.safeParse(entry);
    if (!parsed.success || !usableBox(parsed.data.box_2d)) continue;
    garments.push({
      box: parsed.data.box_2d,
      category: toCategory(parsed.data.label),
      description: (parsed.data.description ?? parsed.data.label).slice(0, 400),
      issues: toIssues(parsed.data.issues),
    });
    if (garments.length === MAX_GARMENTS_PER_PHOTO) break;
  }
  // Free tier: no charge. cost_usd stays 0 so ai_calls shows the free path is in use.
  return { garments, log: { ...base, latency_ms: Date.now() - started, ok: true, cost_usd: 0, ...usage } };
}

type GeminiResponse = {
  candidates?: Array<{ content?: { parts?: Array<{ text?: string; inlineData?: { mimeType?: string; data?: string } }> }; finishReason?: string }>;
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
  promptFeedback?: { blockReason?: string };
};

export type EnhanceResult = { png: Uint8Array | null; billingRequired: boolean; log: AiLogEntry };

/**
 * Optional step: redraws one cutout as a clean product photo (paid model, only on the user's request). Never throws.
 * `billingRequired` is true when Google refuses because the project is on the free tier, so the app can say so
 * instead of a generic failure. Other failure modes: missing key, HTTP error, safety block, no image in the answer.
 */
export async function enhanceGarment(image: Uint8Array, mimeType: string, description: string): Promise<EnhanceResult> {
  const started = Date.now();
  const base = { provider: "google" as const, model: ENHANCE_MODEL, task: "separate" as const };
  const fail = (error: string, extra: Partial<AiLogEntry> = {}, billingRequired = false): EnhanceResult => ({
    billingRequired,
    png: null,
    log: { ...base, latency_ms: Date.now() - started, ok: false, error: error.slice(0, 300), ...extra },
  });

  // don't touch / a separate key from a separate Google project (Roy, 2026-11-08): only that project has billing
  // and the AI Pro credit, so detection keeps running on the free tier of the main project.
  const key = Deno.env.get("GEMINI_IMAGE_API_KEY") ?? Deno.env.get("GEMINI_API_KEY");
  if (!key) return fail("GEMINI_IMAGE_API_KEY is not set");

  let res: Response;
  try {
    res = await fetch(endpoint(ENHANCE_MODEL), {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: enhancePrompt(description) }, { inline_data: { mime_type: mimeType, data: toBase64(image) } }] }],
        generationConfig: { responseModalities: ["IMAGE"], imageConfig: { aspectRatio: "3:4" } },
      }),
      signal: AbortSignal.timeout(60_000),
    });
  } catch (error) {
    return fail(`network: ${String(error)}`);
  }
  if (!res.ok) {
    const detail = (await res.text()).slice(0, 200);
    // Image models have no free tier: Google answers 429 (zero quota) or 400/403 mentioning billing.
    const billing = res.status === 429 || /billing|free tier|quota/i.test(detail);
    return fail(`HTTP ${res.status}: ${detail}`, {}, billing);
  }

  const body = (await res.json()) as GeminiResponse;
  const inputTokens = body.usageMetadata?.promptTokenCount ?? 0;
  const usage = { input_tokens: inputTokens, output_tokens: body.usageMetadata?.candidatesTokenCount ?? 0 };
  if (body.promptFeedback?.blockReason) return fail(`blocked: ${body.promptFeedback.blockReason}`, usage);
  const part = body.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data);
  if (!part?.inlineData?.data) return fail(`no image (${body.candidates?.[0]?.finishReason ?? "unknown"})`, usage);

  const cost = Math.round((inputTokens * ENHANCE_PRICE.input_token + ENHANCE_PRICE.image) * 100_000) / 100_000;
  return {
    billingRequired: false,
    png: fromBase64(part.inlineData.data),
    log: { ...base, latency_ms: Date.now() - started, ok: true, images: 1, cost_usd: cost, ...usage },
  };
}

// don't touch / chunked: String.fromCharCode(...bytes) on a 1MB photo overflows the call stack.
export function toBase64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

function fromBase64(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
