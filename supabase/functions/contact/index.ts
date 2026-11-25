import { adminClient, authenticate } from "../_shared/auth.ts";
import { percentUsed, quotaState } from "../_shared/quota.ts";
import { handleContact, sendWithResend } from "./handler.ts";

/**
 * contact: the "contact Roy" form. The contract and every failure mode are on `handleContact` (handler.ts); this
 * file wires the live reads and writes. Service role, so every query filters on the user explicitly; the table's
 * RLS lets users read only their own requests and write none.
 */
Deno.serve((req) => {
  const db = adminClient();
  return handleContact(req, {
    authenticate,
    async countSince(userId, since) {
      let query = db.from("contact_requests").select("id", { count: "exact", head: true }).gte("created_at", since.toISOString());
      if (userId !== null) query = query.eq("user_id", userId);
      const { count, error } = await query;
      if (error) console.error("contact count failed", error.message);
      return error ? null : count ?? 0;
    },
    async sender(userId) {
      const { data } = await db.auth.admin.getUserById(userId);
      const meta = (data.user?.user_metadata ?? {}) as Record<string, unknown>;
      const name = typeof meta.full_name === "string" ? meta.full_name : typeof meta.name === "string" ? meta.name : null;
      return { id: userId, email: data.user?.email ?? null, name };
    },
    async usage(userId) {
      const state = await quotaState(userId);
      if (state.allowance === null) return null;
      return {
        percent: state.usage ? percentUsed(state.usage, state.allowance) : null,
        usd: state.usage?.usd ?? null,
        usdLimit: state.allowance.usd,
        cutouts: state.usage?.cutouts ?? null,
        cutoutLimit: state.allowance.cutouts,
      };
    },
    async save(userId, input) {
      const { data, error } = await db.from("contact_requests").insert({ user_id: userId, kind: input.kind, message: input.message }).select("id").single();
      if (error) console.error("contact save failed", error.message);
      return error || !data ? null : Number(data.id);
    },
    sendEmail: (email) => sendWithResend(email, Deno.env.get("RESEND_API_KEY")),
    async markEmailed(id) {
      const { error } = await db.from("contact_requests").update({ emailed: true }).eq("id", id);
      if (error) console.error("contact markEmailed failed", error.message);
    },
    now: () => new Date(),
  });
});
