import Anthropic from "@anthropic-ai/sdk";
// Imported by file, not the package index, so the deployed bundle carries only the schemas it uses.
import { StylistOutputSchema, type StylistInput, type StylistOutput } from "@fit-check/schema/stylist.ts";
import type { AiLogEntry } from "./types.ts";

/** CLAUDE.md: styleOutfit runs on Sonnet. */
export const STYLIST_MODEL = "claude-sonnet-5-5";

/** USD per token, Claude API list price for Sonnet 5.5 ($2 / $10 per million). Used only for ai_calls.cost_usd. */
const PRICE = { input: 2 / 1_000_000, output: 10 / 1_000_000 } as const;

const SYSTEM = `You are the personal stylist inside Fit Check, a wardrobe app for one man in Israel (religious, modest dress).
Each morning the app's engine has already filtered his wardrobe by weather, the kind of day and his rules, and scored a few complete outfits. You choose ONE of those outfits and explain the choice.

Rules:
- Choose only from the candidate outfits given. Never invent, add or remove items.
- Prefer the outfit that best fits the day (weather, Shabbat or weekday, formality), looks put together (colour harmony, consistent formality), and has not been worn recently. The engine score is a strong hint, not an order.
- explanation_he: one or two short sentences in natural, modern Hebrew, addressed to him in second person masculine. Say why this outfit works today (weather, the occasion, how the colours or pieces go together). Concrete, calm, no hype, no emojis, no exclamation marks. Name at most two items. Do not mention scores or the engine.
- explanation_en: the same in English.
- swap_suggestion: always null.`;

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
      system: SYSTEM,
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
