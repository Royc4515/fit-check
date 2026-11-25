import { adminClient } from "../_shared/auth.ts";
import { ownerIdFromEnv } from "../_shared/quota.ts";
import { handleShowcase, type SavedLook } from "./handler.ts";

/** How many saved looks to read: enough to skip a few that lost a garment, without reading the whole collection. */
const LOOKS = 10;

/**
 * showcase: the owner's look for the sign-in cover. The contract and every failure mode are on `handleShowcase`
 * (handler.ts); this file wires the live read. Service role, filtered on the owner explicitly.
 */
Deno.serve((req) => {
  const db = adminClient();
  return handleShowcase(req, {
    ownerId: ownerIdFromEnv(),
    async savedLooks(ownerId) {
      const { data, error } = await db
        .from("outfits")
        .select("outfit_items(slot, items(id, status, cutout_path, thumb_path, tags))")
        .eq("user_id", ownerId)
        .not("saved_at", "is", null)
        .order("is_favorite", { ascending: false })
        .order("saved_at", { ascending: false })
        .limit(LOOKS);
      if (error || !data) {
        console.error("showcase read failed", error?.message);
        return null;
      }
      return data.map((row): SavedLook => ({
        pieces: (row.outfit_items ?? []).flatMap((p) => {
          // A to-one join comes back as an object; an array here would mean the join changed shape.
          const item = Array.isArray(p.items) ? p.items[0] : p.items;
          return item ? [{ slot: p.slot as string, item: item as SavedLook["pieces"][number]["item"] }] : [];
        }),
      }));
    },
  });
});
