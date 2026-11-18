import type { RedrawHistoryEntry } from "@fit-check/engine";
import { IntakeQuoteResultSchema, RedrawSpecSchema, type IntakeQuoteResult, type RedrawSpec } from "@fit-check/schema";
import { supabase } from "../lib/supabase";
import { getSnapshot, isPreview, PreviewReadOnlyError } from "./preview";

/**
 * Data for the AI redraw composer (Roy, 2026-11-18): past redraw specs for ranking and reopening, the price quote,
 * and storing the spec of a redraw that worked. `items.redraw_spec` is the only storage (migration 0005).
 */

export type RedrawContext = { history: RedrawHistoryEntry[] };

/**
 * Every stored redraw spec in the wardrobe (RLS keeps it to the signed-in user). A spec that no longer parses (a
 * renamed chip) is skipped: it only costs a suggestion, never the composer. Empty on any error, for the same reason.
 */
export async function fetchRedrawHistory(): Promise<RedrawContext> {
  // Design preview (web only, temporary): the snapshot holds the same rows, already filtered the same way.
  if (isPreview()) {
    try {
      return historyFromRows((await getSnapshot()).redraw_specs);
    } catch (error) {
      console.error("redraw history unavailable", error);
      return { history: [] };
    }
  }
  const { data, error } = await supabase.from("items").select("id,redraw_spec").not("redraw_spec", "is", null).neq("status", "archived");
  if (error) {
    console.error("redraw history unavailable", error.message);
    return { history: [] };
  }
  return historyFromRows(data ?? []);
}

function historyFromRows(rows: readonly { id: string; redraw_spec?: unknown }[]): RedrawContext {
  const history: RedrawHistoryEntry[] = [];
  for (const row of rows) {
    const spec = RedrawSpecSchema.safeParse(row.redraw_spec);
    if (spec.success) history.push({ itemId: row.id, spec: spec.data });
  }
  return { history };
}

/** The item's last redraw spec, from a loaded history. */
export const previousSpec = (ctx: RedrawContext, itemId: string | null | undefined): RedrawSpec | null =>
  (itemId ? ctx.history.find((h) => h.itemId === itemId)?.spec : undefined) ?? null;

/** Price of one redraw and the month's remaining Google budget. Never throws. */
export async function quoteRedraw(): Promise<IntakeQuoteResult> {
  // Design preview: no price to show. The composer already renders without a quote (as when offline).
  if (isPreview()) return { ok: false, reason: "preview" };
  try {
    const { data, error } = await supabase.functions.invoke("intake-separate", { body: { action: "quote" } });
    if (error) return { ok: false, reason: "network" };
    const parsed = IntakeQuoteResultSchema.safeParse(data);
    return parsed.success ? parsed.data : { ok: false, reason: "bad_response" };
  } catch {
    return { ok: false, reason: "network" };
  }
}

/** Stores the spec of a redraw the item now shows. Logged, not thrown: the image is what matters, the spec is memory. */
export async function saveRedrawSpec(itemId: string, spec: RedrawSpec): Promise<void> {
  // Design preview: a no-op that logs like a failed save, which is what callers already expect from this function.
  if (isPreview()) {
    console.error("redraw spec not saved", new PreviewReadOnlyError("saveRedrawSpec").message);
    return;
  }
  const { error } = await supabase.from("items").update({ redraw_spec: spec }).eq("id", itemId);
  if (error) console.error("redraw spec not saved", error.message);
}
