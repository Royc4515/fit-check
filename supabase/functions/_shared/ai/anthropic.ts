import Anthropic from "@anthropic-ai/sdk";
// Imported by file, not the package index, so the deployed bundle carries only the schemas it uses.
import { StylistOutputSchema, type StylistInput, type StylistOutput } from "@fit-check/schema/stylist.ts";
import { CATEGORIES } from "@fit-check/schema/item-tags.ts";
import { GarmentListSchema, MAX_GARMENTS_PER_PHOTO, type GarmentList } from "@fit-check/schema/intake.ts";
import { toBase64 } from "./gemini.ts";
import { STYLIST_SYSTEM } from "./stylist-persona.ts";
import type { AiLogEntry } from "./types.ts";

/** CLAUDE.md: styleOutfit runs on Sonnet. */
export const STYLIST_MODEL = "claude-sonnet-5-5";

/** USD per token, Claude API list price for Sonnet 5.5 ($2 / $10 per million). Used only for ai_calls.cost_usd. */
const PRICE = { input: 2 / 1_000_000, output: 10 / 1_000_000 } as const;

/** The JSON schema the API enforces. chosen_outfit_id is an enum of the ids actually offered, so a made-up id cannot come back. */
function outputSchema(candidateIds: string[]) {
  return {
    type: "object",
    properties: {
      chosen_outfit_id: { type: "string", enum: candidateIds },
      explanation_he: { type: "string" },
      explanation_en: { type: "string" },
      swap_suggestion: { type: "null" },
    },
    required: ["chosen_outfit_id", "explanation_he", "explanation_en", "swap_suggestion"],
    additionalProperties: false,
  };
}

/** Only what the model needs, in a compact form; ids stay so it can answer with one. */
function describe(input: StylistInput): string {
  const lines = [
    `Day: ${input.date_label_he} (${input.context_type})`,
    `Weather: ${input.weather_summary}`,
    input.recent_outfits_summary.length > 0 ? `Worn recently (newest first):\n${input.recent_outfits_summary.map((s) => `- ${s}`).join("\n")}` : "Worn recently: nothing logged",
    "Candidate outfits:",
    ...input.candidates.map(
      (c) =>
        `- id ${c.outfit_id} (score ${c.score.toFixed(2)}): ` +
        c.items.map((i) => `${i.slot}: ${i.name} (${i.subcategory}, ${i.color_name}, formality ${i.formality})`).join("; ")
    ),
  ];
  return lines.join("\n");
}

export type StyleResult = { output: StylistOutput; log: AiLogEntry } | { output: null; log: AiLogEntry };

/**
 * styleOutfit: Sonnet picks one of at most 8 engine candidates and explains it (schema in packages/schema/stylist.ts).
 *
 * Inputs: an already-validated StylistInput. Failure modes, all returned as `output: null` with the reason in
 * `log.error` (never thrown, so the caller always logs and falls back to the top-scored candidate):
 * missing key, API error, refusal (after the server-side fallback also declined), truncated output,
 * JSON that does not parse, or JSON that fails the zod schema.
 */
export async function styleOutfit(input: StylistInput): Promise<StyleResult> {
  const started = Date.now();
  const base = { provider: "anthropic" as const, model: STYLIST_MODEL, task: "style" as const };
  const fail = (error: string, usage?: { input_tokens: number; output_tokens: number }): StyleResult => ({
    output: null,
    log: {
      ...base,
      latency_ms: Date.now() - started,
      ok: false,
      error,
      ...(usage ? cost(usage) : {}),
    },
  });

  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) return fail("ANTHROPIC_API_KEY is not set");
  const client = new Anthropic({ apiKey, maxRetries: 1, timeout: 45_000 });

  try {
    const response = await client.beta.messages.create({
      model: STYLIST_MODEL,
      max_tokens: 4000,
      // Medium: a choice among a handful of options with a two-sentence answer does not need deep reasoning,
      // and the user is waiting on the Today screen.
      output_config: {
        effort: "medium",
        format: { type: "json_schema", schema: outputSchema(input.candidates.map((c) => c.outfit_id)) },
      },
      // A declined request is re-run on Anthropic's recommended fallback model instead of failing.
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system: STYLIST_SYSTEM,
      messages: [{ role: "user", content: describe(input) }],
    });

    const usage = { input_tokens: response.usage.input_tokens, output_tokens: response.usage.output_tokens };
    if (response.stop_reason === "refusal") return fail("refusal", usage);
    if (response.stop_reason === "max_tokens") return fail("max_tokens", usage);
    const text = response.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      return fail("invalid JSON", usage);
    }
    const parsed = StylistOutputSchema.safeParse(json);
    if (!parsed.success) return fail(`schema: ${parsed.error.issues[0]?.message ?? "invalid"}`, usage);
    if (!input.candidates.some((c) => c.outfit_id === parsed.data.chosen_outfit_id)) return fail("unknown outfit id", usage);
    return { output: parsed.data, log: { ...base, latency_ms: Date.now() - started, ok: true, ...cost(usage) } };
  } catch (error) {
    if (error instanceof Anthropic.RateLimitError) return fail("rate limited");
    if (error instanceof Anthropic.AuthenticationError) return fail("authentication failed (check ANTHROPIC_API_KEY)");
    if (error instanceof Anthropic.APIError) return fail(`API ${error.status}: ${error.message}`.slice(0, 300));
    return fail(`network: ${String(error)}`.slice(0, 300));
  }
}

function cost(usage: { input_tokens: number; output_tokens: number }) {
  return {
    input_tokens: usage.input_tokens,
    output_tokens: usage.output_tokens,
    cost_usd: Math.round((usage.input_tokens * PRICE.input + usage.output_tokens * PRICE.output) * 100_000) / 100_000,
  };
}

/** Listing garments before extraction: a vision task with a short JSON answer, so Haiku. */
export const LIST_MODEL = "claude-haiku-5-5";
const LIST_PRICE = { input: 0.1 / 1_000_000, output: 0.5 / 1_000_000 } as const;

const LIST_SYSTEM = `You look at one photo from a man's wardrobe app and list the separate garments in it that could be added to his wardrobe.
- Include tops, trousers, shoes, knits, jackets and accessories that are clearly visible and mostly complete.
- Skip anything mostly hidden, cut off by the frame, or not clothing. Skip the person's face, skin and body.
- One entry per physical garment. A pair of shoes is one entry.
- description: in English, specific enough for an image editor to find exactly that garment and nothing else: colour, type, and one or two distinguishing details (collar, pattern, logo position, where it lies in the photo).
- At most ${MAX_GARMENTS_PER_PHOTO}. If there is no garment, return an empty list.`;

export type ListResult = { output: GarmentList | null; log: AiLogEntry };

/**
 * Lists the garments in a photo (step 1 of separateGarments). Never throws; failure modes as styleOutfit: missing
 * key, API error, refusal, truncation, invalid JSON, schema mismatch.
 */
export async function listGarments(image: Uint8Array, mediaType: "image/jpeg" | "image/png" | "image/webp"): Promise<ListResult> {
  const started = Date.now();
  const base = { provider: "anthropic" as const, model: LIST_MODEL, task: "separate" as const };
  const fail = (error: string, usage?: { input_tokens: number; output_tokens: number }): ListResult => ({
    output: null,
    log: { ...base, latency_ms: Date.now() - started, ok: false, error, images: 1, ...(usage ? listCost(usage) : {}) },
  });
  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) return fail("ANTHROPIC_API_KEY is not set");
  const client = new Anthropic({ apiKey, maxRetries: 1, timeout: 45_000 });

  try {
    const response = await client.messages.create({
      model: LIST_MODEL,
      max_tokens: 3000,
      output_config: {
        effort: "low",
        format: {
          type: "json_schema",
          schema: {
            type: "object",
            properties: {
              garments: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    category: { type: "string", enum: [...CATEGORIES] },
                    description: { type: "string" },
                  },
                  required: ["category", "description"],
                  additionalProperties: false,
                },
              },
            },
            required: ["garments"],
            additionalProperties: false,
          },
        },
      },
      system: LIST_SYSTEM,
      messages: [
        {
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: mediaType, data: toBase64(image) } },
            { type: "text", text: "List the garments in this photo." },
          ],
        },
      ],
    });
    const usage = { input_tokens: response.usage.input_tokens, output_tokens: response.usage.output_tokens };
    if (response.stop_reason === "refusal") return fail("refusal", usage);
    if (response.stop_reason === "max_tokens") return fail("max_tokens", usage);
    const text = response.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      return fail("invalid JSON", usage);
    }
    // The schema caps the list; a longer answer is trimmed rather than rejected (the first garments are still good).
    const trimmed = json && typeof json === "object" && Array.isArray((json as { garments?: unknown }).garments)
      ? { garments: (json as { garments: unknown[] }).garments.slice(0, MAX_GARMENTS_PER_PHOTO) }
      : json;
    const parsed = GarmentListSchema.safeParse(trimmed);
    if (!parsed.success) return fail(`schema: ${parsed.error.issues[0]?.message ?? "invalid"}`, usage);
    return { output: parsed.data, log: { ...base, latency_ms: Date.now() - started, ok: true, images: 1, ...listCost(usage) } };
  } catch (error) {
    if (error instanceof Anthropic.APIError) return fail(`API ${error.status}: ${error.message}`.slice(0, 300));
    return fail(`network: ${String(error)}`.slice(0, 300));
  }
}

function listCost(usage: { input_tokens: number; output_tokens: number }) {
  return {
    input_tokens: usage.input_tokens,
    output_tokens: usage.output_tokens,
    cost_usd: Math.round((usage.input_tokens * LIST_PRICE.input + usage.output_tokens * LIST_PRICE.output) * 100_000) / 100_000,
  };
}
