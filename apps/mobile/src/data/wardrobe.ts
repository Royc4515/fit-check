import { pairKey, type PairWeights } from "@fit-check/engine";
import { ITEM_READ_COLUMNS, itemFromRow, type Item } from "@fit-check/schema";
import { supabase } from "../lib/supabase";

export type WardrobeData = { items: Item[]; pairWeights: PairWeights };

/**
 * Loads the signed-in user's wardrobe and learned pair weights. RLS scopes both queries to `auth.uid()`, so
 * there is deliberately no user_id filter here: adding one would only hide a broken policy.
 *
 * A row that violates the frozen tag schema is skipped and logged with its id instead of failing the whole load:
 * one bad item must not blank the wardrobe, but it must also never render as garbage or vanish silently.
 *
 * Throws on a network or permission error; callers decide whether stale cache is good enough.
 */
export async function fetchWardrobe(): Promise<WardrobeData> {
  const [itemsRes, pairsRes] = await Promise.all([
    supabase.from("items").select(ITEM_READ_COLUMNS).order("created_at", { ascending: true }),
    supabase.from("pair_weights").select("item_a,item_b,weight"),
  ]);
  if (itemsRes.error) throw itemsRes.error;
  if (pairsRes.error) throw pairsRes.error;

  const items: Item[] = [];
  for (const row of itemsRes.data ?? []) {
    try {
      items.push(itemFromRow(row));
    } catch (error) {
      console.error("Skipping malformed item row", (row as { id?: unknown }).id, error);
    }
  }

  const pairWeights: PairWeights = new Map(
    (pairsRes.data ?? []).map((p) => [pairKey(p.item_a, p.item_b), Number(p.weight)])
  );
  return { items, pairWeights };
}
