import { adminClient } from "../_shared/auth.ts";
import { RECENT_WEARS_DAYS } from "../_shared/engine.js";
import { ITEM_READ_COLUMNS, WEAR_READ_COLUMNS } from "@fit-check/schema/db.ts";
import { DesignPreviewInputSchema, DesignPreviewSnapshotSchema, type DesignPreviewSnapshot } from "@fit-check/schema/design-preview.ts";
import { sameCode } from "./code.ts";

/**
 * design-preview: TEMPORARY (Roy, 2026-11-18). A read-only snapshot of Roy's wardrobe for the web app's preview mode,
 * so a designer (another Claude in a real browser) can see the live app without Google sign-in.
 *
 * Expires 2026-11-25T16:00:00Z (seven days, Roy's choice). After that it answers 410 to everyone; retire it to a
 * plain 410, delete the DESIGN_PREVIEW_CODE secret and revert the app's preview-mode commits
 * (CHANGELOG 2026-11-18, design preview).
 *
 * Input: POST JSON { code } (DesignPreviewInputSchema). The code lives only in the function's env
 * (DESIGN_PREVIEW_CODE), never in the source, and is compared in constant time (code.ts).
 * Output: 200 DesignPreviewSnapshot for OWNER only, in the same row shapes the app's own reads return: items
 * (ITEM_READ_COLUMNS), pair_weights, wears (WEAR_READ_COLUMNS, the last RECENT_WEARS_DAYS + 1 days; the app trims
 * to its own local date) and the stored redraw specs.
 *
 * It never writes and never calls an AI provider. The service role bypasses RLS, so every query carries an explicit
 * `user_id = OWNER` filter.
 *
 * Failure modes, none with data: 405 not POST | 410 expired | 401 missing, malformed or wrong code (also when the
 * secret is not set) | 500 a query failed or the rows no longer fit the snapshot schema.
 */

// don't touch / hard-coded on purpose: the preview must die on its own even if nobody remembers to remove it.
const EXPIRES = Date.parse("2026-11-25T16:00:00Z");
// don't touch / the only user whose rows this function may ever return. The app's preview.ts holds the same id.
const OWNER = "f797bc43-e210-4f93-891d-a7616643a0d8";

// The browser calls this from the Vercel origin, so it needs CORS like the app's other functions.
const cors = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, x-client-info, apikey, content-type",
  "access-control-allow-methods": "POST, OPTIONS",
};
// no-store: the body is Roy's wardrobe; no browser or proxy cache should keep a copy.
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store", ...cors } });

/** yyyy-mm-dd `days` before today in UTC. */
const utcDaysAgo = (days: number) => new Date(Date.now() - days * 24 * 3600 * 1000).toISOString().slice(0, 10);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json(405, { ok: false, reason: "method" });
  if (Date.now() > EXPIRES) return json(410, { ok: false, reason: "expired" });

  // Malformed body, missing code and wrong code all answer the same 401: telling them apart helps only a guesser.
  const body: unknown = await req.json().catch(() => null);
  const input = DesignPreviewInputSchema.safeParse(body);
  const expected = Deno.env.get("DESIGN_PREVIEW_CODE") ?? "";
  if (!expected) console.error("design-preview: DESIGN_PREVIEW_CODE is not set");
  if (!input.success || !(await sameCode(input.data.code, expected))) return json(401, { ok: false, reason: "unauthorized" });

  const db = adminClient();
  // The wear window is one day wider than the app's: the server's UTC date can be a day off the viewer's local date.
  const since = utcDaysAgo(RECENT_WEARS_DAYS + 1);
  const [items, pairs, wears, specs] = await Promise.all([
    db.from("items").select(ITEM_READ_COLUMNS).eq("user_id", OWNER).order("created_at", { ascending: true }),
    db.from("pair_weights").select("item_a,item_b,weight").eq("user_id", OWNER),
    db.from("wears")
      .select(WEAR_READ_COLUMNS)
      .eq("user_id", OWNER)
      .gte("worn_on", since)
      .order("worn_on", { ascending: false })
      .order("created_at", { ascending: false }),
    db.from("items").select("id,redraw_spec").eq("user_id", OWNER).not("redraw_spec", "is", null).neq("status", "archived"),
  ]);
  const failed = [items, pairs, wears, specs].find((r) => r.error);
  if (failed?.error) {
    console.error("design-preview: query failed", failed.error.message);
    return json(500, { ok: false, reason: "db_error" });
  }

  // Parsed with the schema the app parses it with, so a shape drift fails here, loudly, instead of in the browser.
  const snapshot = DesignPreviewSnapshotSchema.safeParse({
    ok: true,
    owner: OWNER,
    expires_at: new Date(EXPIRES).toISOString(),
    items: items.data ?? [],
    pair_weights: pairs.data ?? [],
    wears: wears.data ?? [],
    redraw_specs: specs.data ?? [],
  } satisfies Record<keyof DesignPreviewSnapshot, unknown>);
  if (!snapshot.success) {
    console.error("design-preview: snapshot shape", snapshot.error.message);
    return json(500, { ok: false, reason: "bad_shape" });
  }
  return json(200, snapshot.data);
});
