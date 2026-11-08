import { authenticate } from "../_shared/auth.ts";
import { StylistInputSchema } from "@fit-check/schema/stylist.ts";
import { styleOutfit } from "../_shared/ai/anthropic.ts";
import { countAiCalls, logAiCall } from "../_shared/ai/log.ts";

/**
 * style-outfit: the AI stylist for the Today screen (docs/PLAN.md stage B).
 *
 * Input (POST JSON): { input: StylistInput } with at most 8 engine candidates. The engine runs in the app; only
 * its shortlist reaches here, so the model never sees the wardrobe (CLAUDE.md).
 * Auth: the caller's Supabase JWT (verify_jwt on, and the user is re-read here for the id used in logs and caps).
 *
 * Responses, all JSON:
 * - 200 { ok: true, output: StylistOutput }
 * - 200 { ok: false, reason: "ai_failed" }  the model failed or its output was invalid; the app shows the
 *   top-scored candidate without an explanation. Logged in ai_calls with the reason.
 * - 400 { ok: false, reason: "bad_input", detail }    input did not match StylistInputSchema
 * - 401 { ok: false, reason: "unauthorized" }
 * - 429 { ok: false, reason: "daily_limit" }          more than DAILY_LIMIT calls today (spend guard)
 */

/** Spend guard: about $0.01 per call, so 30 calls cap a bad loop at roughly $0.30 a day. */
const DAILY_LIMIT = 30;

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...cors } });

const cors = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, x-client-info, apikey, content-type",
  "access-control-allow-methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json(405, { ok: false, reason: "method" });

  const auth = await authenticate(req);
  if (!auth.ok) return json(401, { ok: false, reason: "unauthorized", detail: auth.detail });
  const { userId } = auth;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json(400, { ok: false, reason: "bad_input", detail: "body is not JSON" });
  }
  const parsed = StylistInputSchema.safeParse((body as { input?: unknown } | null)?.input);
  if (!parsed.success) return json(400, { ok: false, reason: "bad_input", detail: parsed.error.issues.slice(0, 3) });

  // Rolling 24 hours rather than "today": no timezone to get wrong, same protection.
  const used = await countAiCalls(userId, "style", new Date(Date.now() - 24 * 3600 * 1000));
  if (used === null || used >= DAILY_LIMIT) return json(429, { ok: false, reason: "daily_limit" });

  const result = await styleOutfit(parsed.data);
  await logAiCall(userId, result.log);
  if (!result.output) return json(200, { ok: false, reason: "ai_failed" });
  return json(200, { ok: true, output: result.output });
});
