import { ItemTagsSchema } from "@fit-check/schema/item-tags.ts";
import type { ShowcasePiece, ShowcaseResponse } from "@fit-check/schema/showcase.ts";

/** One saved look as read from the database, before any check. */
export type SavedLook = {
  pieces: { slot: string; item: { id: string; status: string; cutout_path: string | null; thumb_path: string | null; tags: unknown } }[];
};

const NEEDED = ["top", "bottom", "shoes"] as const;
const SLOTS = new Set(["top", "bottom", "shoes", "layer"]);

/**
 * The look for the cover: the first of `looks` (already ordered: favourites first, newest saved first) that can be
 * shown whole: a top, a bottom and shoes, every garment still in the wardrobe, with a photo and valid tags, and no
 * slot twice. A look that fails any of these is skipped, never shown in part. Pure.
 */
export function pickShowcase(looks: readonly SavedLook[]): ShowcasePiece[] | null {
  for (const look of looks) {
    const pieces: ShowcasePiece[] = [];
    for (const { slot, item } of look.pieces) {
      const tags = ItemTagsSchema.safeParse(item.tags);
      if (!SLOTS.has(slot) || item.status !== "active" || !item.cutout_path || !tags.success) break;
      pieces.push({ slot: slot as ShowcasePiece["slot"], item: { id: item.id, tags: tags.data, cutout_path: item.cutout_path, thumb_path: item.thumb_path } });
    }
    const slots = new Set(pieces.map((p) => p.slot));
    const whole = pieces.length === look.pieces.length && slots.size === pieces.length && NEEDED.every((s) => slots.has(s));
    if (whole) return pieces;
  }
  return null;
}

/** What the handler needs from the outside world; index.ts passes the live ones, tests pass stubs. */
export interface ShowcaseDeps {
  /** The owner's user id (OWNER_USER_ID), or null when it is not set. */
  ownerId: string | null;
  /** The owner's saved looks, favourites first, newest saved first; null when the read failed. */
  savedLooks(ownerId: string): Promise<SavedLook[] | null>;
}

const cors = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, x-client-info, apikey, content-type",
  "access-control-allow-methods": "GET, POST, OPTIONS",
};

/**
 * showcase: the owner's look for the sign-in cover. Public on purpose (the visitor is not signed in yet); it only
 * reads, and answers only slots, tags and photo paths of one saved look (photos are public in R2 already).
 *
 * Input: none (GET or POST). Responses: 200 ShowcaseResponse (`none` when there is no whole look or no owner;
 * `error` when the read failed) | 405. Cached by the browser for 10 minutes: the cover changes when the owner marks
 * another favourite, not by the second.
 */
export async function handleShowcase(req: Request, deps: ShowcaseDeps): Promise<Response> {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const json = (status: number, body: ShowcaseResponse | { ok: false; reason: string }, cache = false) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json", ...(cache ? { "cache-control": "public, max-age=600" } : {}), ...cors },
    });
  if (req.method !== "GET" && req.method !== "POST") return json(405, { ok: false, reason: "method" });
  if (deps.ownerId === null) return json(200, { ok: false, reason: "none" });
  const looks = await deps.savedLooks(deps.ownerId);
  if (looks === null) return json(200, { ok: false, reason: "error" });
  const pieces = pickShowcase(looks);
  return pieces === null ? json(200, { ok: false, reason: "none" }, true) : json(200, { ok: true, pieces }, true);
}
