import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import type { AiLogEntry } from "./types.ts";

/**
 * Same garment twice? (Roy, 2026-11-10: items get added again by mistake, or a multi-garment photo is uploaded a
 * second time.) The tagger's subcategory and colour narrow the wardrobe to a few look-alikes; this call compares
 * the photos and says whether one of them is the same physical garment. A second Haiku call, not part of tagItem,
 * so a failure here never costs the user the tags.
 */
const MODEL = "claude-haiku-5-5";
const PRICE = { input: 0.1 / 1e6, output: 0.5 / 1e6 } as const;
/** Look-alikes compared per garment: enough for a wardrobe with several navy shirts, cheap enough to run always. */
export const MAX_CANDIDATES = 4;

export type Candidate = { id: string; name: string; image: { bytes: Uint8Array; mediaType: string } };
export type DuplicateResult = { matchId: string | null; log: AiLogEntry };

const OutputSchema = z.object({ match: z.number().int().nullable(), confidence: z.enum(["high", "low"]) });
const OUTPUT_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["match", "confidence"],
  properties: { match: { type: ["integer", "null"] }, confidence: { type: "string", enum: ["high", "low"] } },
} as const;

const SYSTEM = `You compare garment photos for a personal wardrobe app. The first photo is a garment the owner is adding now. The numbered photos are garments already in his wardrobe that look similar (same type and colour).
Decide whether the new garment is the SAME physical item as one of the numbered ones: same cut, collar, buttons, pockets, pattern scale, logo and fabric. Different lighting, angle, background, folding or a hanger do not make it different. Two similar but different garments (for example two navy oxford shirts with different collars) are NOT the same. Sleeve length and leg length are decisive: a short-sleeved and a long-sleeved shirt, or shorts and full-length trousers, are never the same item.
Answer with the number of the matching photo in "match", or null if none is the same item. "confidence" is high only when you would bet on it.`;

function base64(bytes: Uint8Array): string {
  let s = "";
  // don't touch / chunked: spreading a whole photo into fromCharCode overflows the call stack.
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

const asImageType = (t: string) => (t === "image/png" ? "image/png" : t === "image/webp" ? "image/webp" : "image/jpeg");

/**
 * findDuplicate: returns the id of the wardrobe item that is the same garment as `image`, or null. Never throws.
 * Only a high-confidence match is returned: a false "you already have this" is worse than a missed duplicate,
 * because the user might skip a garment he does own twice. Failure modes (missing key, API error, refusal, bad
 * JSON) all return null with the reason in `log.error`.
 */
export async function findDuplicate(image: { bytes: Uint8Array; mediaType: string }, candidates: Candidate[]): Promise<DuplicateResult> {
  const started = Date.now();
  const base = { provider: "anthropic" as const, model: MODEL, task: "tag" as const, images: candidates.length + 1 };
  const done = (matchId: string | null, extra: Partial<AiLogEntry> = {}): DuplicateResult => ({
    matchId,
    log: { ...base, latency_ms: Date.now() - started, ok: !extra.error, ...extra },
  });
  if (candidates.length === 0) return done(null);
  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) return done(null, { error: "ANTHROPIC_API_KEY is not set" });

  const content: Anthropic.Beta.BetaContentBlockParam[] = [
    { type: "text", text: "New garment:" },
    { type: "image", source: { type: "base64", media_type: asImageType(image.mediaType), data: base64(image.bytes) } },
  ];
  candidates.forEach((c, i) => {
    content.push({ type: "text", text: `${i + 1}. ${c.name}` });
    content.push({ type: "image", source: { type: "base64", media_type: asImageType(c.image.mediaType), data: base64(c.image.bytes) } });
  });

  try {
    const client = new Anthropic({ apiKey, maxRetries: 1, timeout: 45_000 });
    const response = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 2000,
      output_config: { effort: "low", format: { type: "json_schema", schema: OUTPUT_JSON_SCHEMA } },
      system: SYSTEM,
      messages: [{ role: "user", content }],
    });
    const u = response.usage;
    const usage = {
      input_tokens: u.input_tokens + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0),
      output_tokens: u.output_tokens,
      cost_usd: Math.round((u.input_tokens * PRICE.input + u.output_tokens * PRICE.output) * 100_000) / 100_000,
    };
    if (response.stop_reason !== "end_turn") return done(null, { ...usage, error: `stop: ${response.stop_reason}` });
    const text = response.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
    const parsed = OutputSchema.safeParse(JSON.parse(text));
    if (!parsed.success) return done(null, { ...usage, error: "schema" });
    const { match, confidence } = parsed.data;
    const hit = match !== null && confidence === "high" ? candidates[match - 1] : undefined;
    return done(hit?.id ?? null, usage);
  } catch (error) {
    if (error instanceof Anthropic.APIError) return done(null, { error: `API ${error.status}: ${error.message}`.slice(0, 300) });
    return done(null, { error: `failed: ${String(error)}`.slice(0, 300) });
  }
}
