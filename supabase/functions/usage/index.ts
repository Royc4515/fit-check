import { meterOf, type UsageResponse } from "@fit-check/schema/usage.ts";
import { authenticate } from "../_shared/auth.ts";
import { MONTHLY_ANTHROPIC_BUDGET_USD, MONTHLY_GOOGLE_BUDGET_USD, monthlyAnthropicSpend, monthlyGoogleSpend } from "../_shared/ai/budget.ts";
import { CLOUDFLARE_CUTOUT_MODEL, monthStart, MONTHLY_CLOUDFLARE_CUTOUTS } from "../_shared/ai/cloudflare.ts";
import { countModelCalls } from "../_shared/ai/log.ts";
import { percentUsed, quotaState } from "../_shared/quota.ts";

/**
 * usage: this month's usage bars (UsageResponseSchema in packages/schema/src/usage.ts). Reads only; no AI call.
 *
 * Input: none (POST or GET), with the caller's Supabase JWT.
 * - Every caller gets `me`: their own allowance and how much of it is used (null meters when they have no
 *   personal limit).
 * - The owner (OWNER_USER_ID) also gets `account`: the account-wide caps across all users, as percentages.
 *
 * Responses: 200 UsageResponse | 401 { ok: false, reason: "unauthorized" } | 405. A figure that cannot be read is
 * null in its meter, never 0.
 */

const cors = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, x-client-info, apikey, content-type",
  "access-control-allow-methods": "GET, POST, OPTIONS",
};
const json = (status: number, body: UsageResponse | { ok: false; reason: string }) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...cors } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "GET" && req.method !== "POST") return json(405, { ok: false, reason: "method" });
  const auth = await authenticate(req);
  if (!auth.ok) return json(401, { ok: false, reason: "unauthorized" });

  const now = new Date();
  const state = await quotaState(auth.userId, now);
  const me =
    state.allowance === null
      ? { ai_usd: null, cutouts: null, percent: null }
      : {
          ai_usd: meterOf(state.usage?.usd ?? null, state.allowance.usd),
          cutouts: meterOf(state.usage?.cutouts ?? null, state.allowance.cutouts),
          percent: state.usage === null ? null : percentUsed(state.usage, state.allowance),
        };

  let account = null;
  if (state.owner) {
    const [google, anthropic, cutouts] = await Promise.all([
      monthlyGoogleSpend(),
      monthlyAnthropicSpend(now),
      countModelCalls(CLOUDFLARE_CUTOUT_MODEL, monthStart(now)),
    ]);
    account = {
      google_usd: meterOf(google, MONTHLY_GOOGLE_BUDGET_USD),
      anthropic_usd: meterOf(anthropic, MONTHLY_ANTHROPIC_BUDGET_USD),
      cutouts: meterOf(cutouts, MONTHLY_CLOUDFLARE_CUTOUTS),
    };
  }
  return json(200, { ok: true, owner: state.owner, me, account });
});
