import type { AiLogEntry } from "./types.ts";

/** CLAUDE.md: separateGarments runs on Gemini's image model. Lite: cheapest, 1024px output, single reference image. */
export const SEPARATE_MODEL = "gemini-3.1-flash-lite-image";

/** USD, Gemini API paid tier (2026-11): $0.25 per 1M input tokens, $0.0336 per 1024px output image. */
const PRICE = { input_token: 0.25 / 1_000_000, image: 0.0336 } as const;

const ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${SEPARATE_MODEL}:generateContent`;

function prompt(description: string): string {
  return [
    `Extract only this garment from the photo: ${description}.`,
    "Render it as a clean e-commerce product photo: the garment alone, laid flat or as if on an invisible mannequin, front view, centred, filling most of the frame.",
    "Background: plain pure white (#FFFFFF), no shadow, no floor, no hanger, no person, no other clothing or objects.",
    "Keep the exact colour, pattern, fabric texture, buttons, logos and proportions of the real garment. Do not invent details, do not restyle it, do not add text.",
  ].join(" ");
}

type GeminiResponse = {
  candidates?: Array<{ content?: { parts?: Array<{ inlineData?: { mimeType?: string; data?: string } }> }; finishReason?: string }>;
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
  promptFeedback?: { blockReason?: string };
};

export type ExtractResult = { png: Uint8Array | null; log: AiLogEntry };

/**
 * separateGarments, one garment per call: the image model returns one picture per request, so a photo with three
 * garments is three calls (run in parallel by the caller). Never throws; every outcome comes back with a log row.
 * Failure modes: missing key, HTTP error, safety block, or a response without an image part.
 */
export async function extractGarment(image: Uint8Array, mimeType: string, description: string): Promise<ExtractResult> {
  const started = Date.now();
  const base = { provider: "google" as const, model: SEPARATE_MODEL, task: "separate" as const };
  const fail = (error: string, extra: Partial<AiLogEntry> = {}): ExtractResult => ({
    png: null,
    log: { ...base, latency_ms: Date.now() - started, ok: false, error: error.slice(0, 300), ...extra },
  });

  const key = Deno.env.get("GEMINI_API_KEY");
  if (!key) return fail("GEMINI_API_KEY is not set");

  let res: Response;
  try {
    res = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt(description) }, { inline_data: { mime_type: mimeType, data: toBase64(image) } }] }],
        generationConfig: { responseModalities: ["IMAGE"], imageConfig: { aspectRatio: "3:4" } },
      }),
      signal: AbortSignal.timeout(60_000),
    });
  } catch (error) {
    return fail(`network: ${String(error)}`);
  }
  if (!res.ok) return fail(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);

  const body = (await res.json()) as GeminiResponse;
  const inputTokens = body.usageMetadata?.promptTokenCount ?? 0;
  const usage = { input_tokens: inputTokens, output_tokens: body.usageMetadata?.candidatesTokenCount ?? 0 };
  if (body.promptFeedback?.blockReason) return fail(`blocked: ${body.promptFeedback.blockReason}`, usage);
  const part = body.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data);
  if (!part?.inlineData?.data) return fail(`no image (${body.candidates?.[0]?.finishReason ?? "unknown"})`, usage);

  const cost = Math.round((inputTokens * PRICE.input_token + PRICE.image) * 100_000) / 100_000;
  return {
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
