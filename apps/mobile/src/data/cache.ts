import type { PairWeights } from "@fit-check/engine";
import { ItemSchema } from "@fit-check/schema";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { z } from "zod";
import { isPreview } from "./preview";
import type { WardrobeData } from "./wardrobe";

// Bump when the cached shape OR the engine's pairKey format changes: an old cache then reads as "no cache" instead of
// crashing a screen or silently never matching a pair.
const VERSION = 1;
const keyFor = (userId: string) => `fitcheck:wardrobe:v${VERSION}:${userId}`;

const CachedSchema = z.object({
  items: z.array(ItemSchema),
  pairs: z.array(z.tuple([z.string(), z.number()])),
});

/**
 * Local cache is an optimization, never the source of truth (CLAUDE.md): Supabase wins on every successful
 * load. Keyed per user so signing in as someone else can never show the previous user's wardrobe.
 * Every failure mode (no cache, corrupt JSON, old shape, storage error) returns null.
 */
export async function readWardrobeCache(userId: string): Promise<WardrobeData | null> {
  // Design preview: no cache either way, so the owner's wardrobe never lands in a visitor's browser storage.
  if (isPreview()) return null;
  try {
    const raw = await AsyncStorage.getItem(keyFor(userId));
    if (raw === null) return null;
    const parsed = CachedSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) return null;
    const pairWeights: PairWeights = new Map(parsed.data.pairs);
    return { items: parsed.data.items, pairWeights };
  } catch {
    return null;
  }
}

export async function writeWardrobeCache(userId: string, data: WardrobeData): Promise<void> {
  if (isPreview()) return;
  try {
    // Stored as the engine's own [key, weight] entries; see VERSION for what invalidates them.
    await AsyncStorage.setItem(keyFor(userId), JSON.stringify({ items: data.items, pairs: [...data.pairWeights.entries()] }));
  } catch {
    // A full disk or blocked storage costs us the offline start, nothing else.
  }
}
