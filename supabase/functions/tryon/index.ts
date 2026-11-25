import { adminClient, authenticate } from "../_shared/auth.ts";
import { monthlyGoogleSpend } from "../_shared/ai/budget.ts";
import { userAllows } from "../_shared/quota.ts";
import { logAiCall } from "../_shared/ai/log.ts";
import { renderFigure, renderOutfit } from "../_shared/ai/tryon.ts";
import { handleTryon } from "./handler.ts";
import { supabaseStore } from "./store.ts";

/**
 * tryon: one generated image of an outfit on the fixed figure (DESIGN.md "שלב 5.3"). The contract, the money
 * checks and every failure mode are documented on `handleTryon` (handler.ts); this file only wires the live
 * dependencies. The gateway checks the JWT (`verify_jwt = true` in supabase/config.toml) and `authenticate`
 * verifies it again here to get the user id.
 */
Deno.serve((req) =>
  handleTryon(req, {
    authenticate,
    store: () => supabaseStore(adminClient()),
    monthlySpend: monthlyGoogleSpend,
    userAllows: (userId) => userAllows(userId, "ai"),
    logAiCall,
    renderOutfit,
    renderFigure,
  })
);
