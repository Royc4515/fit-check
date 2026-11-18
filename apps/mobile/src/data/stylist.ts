import { StylistOutputSchema, type StylistInput, type StylistOutput } from "@fit-check/schema";
import { z } from "zod";
import { supabase } from "../lib/supabase";
import { cacheGet, cacheSet } from "./kv";
import { isPreview } from "./preview";

const ResponseSchema = z.union([
  z.object({ ok: z.literal(true), output: StylistOutputSchema }),
  z.object({ ok: z.literal(false), reason: z.string() }),
]);

/** One answer per day and candidate set: the same shortlist never costs a second call, even across reloads. */
const CACHE_MS = 20 * 3600 * 1000;

function cacheKey(input: StylistInput): string {
  const ids = input.candidates.map((c) => c.outfit_id).join(",");
  return `stylist:v1:${input.date_label_he}:${input.context_type}:${ids}`;
}

/**
 * Asks the style-outfit Edge Function to choose among today's candidates. Returns null whenever there is no
 * usable answer (offline, no key configured yet, daily cap, model failure): the screen then shows the engine's
 * top candidate with the template explanation, which is the designed fallback (CLAUDE.md), not an error state.
 */
export async function requestStyle(input: StylistInput): Promise<StylistOutput | null> {
  // Design preview: never a paid Sonnet call. Null is the designed "no stylist" path: top candidate, template text.
  if (isPreview()) return null;
  const key = cacheKey(input);
  const cached = await cacheGet<StylistOutput>(key, CACHE_MS);
  if (cached && StylistOutputSchema.safeParse(cached).success) return cached;
  try {
    const { data, error } = await supabase.functions.invoke("style-outfit", { body: { input } });
    if (error) {
      console.warn("Stylist unavailable", error.message);
      return null;
    }
    const parsed = ResponseSchema.safeParse(data);
    if (!parsed.success || !parsed.data.ok) {
      console.warn("Stylist gave no answer", parsed.success ? parsed.data : parsed.error);
      return null;
    }
    void cacheSet(key, parsed.data.output);
    return parsed.data.output;
  } catch (error) {
    console.warn("Stylist request failed", error);
    return null;
  }
}
