import { IntakeCutoutInputSchema } from "@fit-check/schema/intake.ts";
import { adminClient, authenticate } from "../_shared/auth.ts";
import { countAiCalls, logAiCall } from "../_shared/ai/log.ts";
import { cutout } from "../_shared/ai/modal.ts";
import { GARMENT_BUCKET, garmentStore } from "../_shared/objects.ts";

/**
 * intake-cutout: removes the background of one cropped garment (PRD section 4, step 3).
 *
 * Input (POST JSON, IntakeCutoutInputSchema): `cutout_path` of a crop the app uploaded to `cutouts/{uid}/...`.
 * Sends it to the Modal worker (BiRefNet) and stores `<crop>-cutout.png` (transparent, trimmed) and
 * `<crop>-thumb.png` (400 px) next to it, in R2 when it is configured (see _shared/objects.ts). Cost is Modal CPU time against the $1 monthly credit.
 *
 * Responses: 200 { ok: true, path, url, thumb_path } | 200 { ok: false, reason } with reason "not_configured"
 * (worker not deployed yet; the app keeps the crop) or "ai_failed" | 400 bad_input / not_found | 401 | 429 (40 a day).
 */

// don't touch / sized to Modal's $1 monthly credit without a card (2026-11): one cutout costs about $0.007 in a batch
// and up to $0.02 alone, so 40 a day leaves a day of adding clothes possible while one runaway day cannot spend the
// whole month. The wardrobe's first import (124 cutouts on 2026-11-10) would now take four days.
const DAILY_CUTOUT_LIMIT = 40;
const MAX_BYTES = 8 * 1024 * 1024;

const cors = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, x-client-info, apikey, content-type",
  "access-control-allow-methods": "POST, OPTIONS",
};
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...cors } });

const MEDIA: Record<string, string> = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp" };
const mediaOf = (path: string) => MEDIA[path.split(".").pop()?.toLowerCase() ?? ""];
const ownPath = (userId: string, path: string) => path.startsWith(`${userId}/`) && !path.includes("..");

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json(405, { ok: false, reason: "method" });

  const auth = await authenticate(req);
  if (!auth.ok) return json(401, { ok: false, reason: "unauthorized" });
  const { userId } = auth;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json(400, { ok: false, reason: "bad_input" });
  }
  const parsed = IntakeCutoutInputSchema.safeParse(body);
  if (!parsed.success) return json(400, { ok: false, reason: "bad_input" });
  const path = parsed.data.cutout_path;
  const mediaType = mediaOf(path);
  // The app's own crops and redraws only: never a previous cutout, thumbnail or label photo.
  if (!ownPath(userId, path) || !mediaType || /-(cutout|thumb|label)/.test(path)) {
    return json(400, { ok: false, reason: "bad_input" });
  }

  const used = await countAiCalls(userId, "cutout", new Date(Date.now() - 24 * 3600 * 1000));
  if (used === null || used >= DAILY_CUTOUT_LIMIT) return json(429, { ok: false, reason: "daily_limit" });

  // Service role (see _shared/auth.ts); ownPath() above keeps reads and writes in this user's folder.
  const store = garmentStore(adminClient().storage.from(GARMENT_BUCKET));
  const bytes = await store.read(path);
  if (!bytes) return json(400, { ok: false, reason: "not_found" });
  if (bytes.length > MAX_BYTES) return json(413, { ok: false, reason: "too_large" });

  // A redraw shows one garment on white; SAM would only add time (and a small risk of trimming it).
  const result = await cutout(bytes, mediaType, !/-enhanced/.test(path));
  // Not configured is not an AI call; logging it would count against the daily cap for nothing.
  if (!result.ok && result.notConfigured) return json(200, { ok: false, reason: "not_configured" });
  await logAiCall(userId, result.log);
  if (!result.ok) {
    console.error("cutout failed", result.log.error);
    return json(200, { ok: false, reason: "ai_failed" });
  }

  const stem = path.replace(/\.[^.]+$/, "");
  const outPath = `${stem}-cutout.png`;
  const thumbPath = `${stem}-thumb.png`;
  // A write replaces an existing key, so re-running the same crop (a retry after a timeout) replaces its cutout.
  const [a, b] = await Promise.all([store.write(outPath, result.cutout, "image/png"), store.write(thumbPath, result.thumb, "image/png")]);
  if (!a || !b) return json(200, { ok: false, reason: "ai_failed" });
  return json(200, { ok: true, path: outPath, thumb_path: thumbPath, url: store.publicUrl(outPath) });
});
