import { adminClient, authenticate } from "../_shared/auth.ts";
import { handleReferral } from "./handler.ts";

/** Postgres unique violation: another user has the code, or this user was referred meanwhile. */
const UNIQUE_VIOLATION = "23505";

/**
 * referral: referral codes and claims. The contract and every failure mode are on `handleReferral` (handler.ts);
 * this file wires the live reads and writes. Service role, so every query filters on the user explicitly; the
 * tables' RLS lets users read only their own rows and write none.
 */
Deno.serve((req) => {
  const db = adminClient();
  return handleReferral(req, {
    authenticate,
    async codeOf(userId) {
      const { data } = await db.from("referral_codes").select("code").eq("user_id", userId).maybeSingle();
      return (data?.code as string | undefined) ?? null;
    },
    async saveCode(userId, code) {
      const { error } = await db.from("referral_codes").insert({ user_id: userId, code });
      if (!error) return "ok";
      if (error.code === UNIQUE_VIOLATION) {
        // The primary key (this user already has a code, from a parallel request) or the code itself: either way the
        // handler reads again or tries another code.
        return "taken";
      }
      console.error("saveCode failed", error.message);
      return "error";
    },
    async ownerOfCode(code) {
      const { data } = await db.from("referral_codes").select("user_id").eq("code", code).maybeSingle();
      return (data?.user_id as string | undefined) ?? null;
    },
    async createdAt(userId) {
      const { data, error } = await db.auth.admin.getUserById(userId);
      if (error || !data.user?.created_at) return null;
      const at = new Date(data.user.created_at);
      return Number.isNaN(at.getTime()) ? null : at;
    },
    async isReferred(userId) {
      const { data } = await db.from("referrals").select("user_id").eq("user_id", userId).maybeSingle();
      return data !== null;
    },
    async countReferrals(referrerId) {
      const { count } = await db.from("referrals").select("user_id", { count: "exact", head: true }).eq("referrer_id", referrerId);
      return count ?? 0;
    },
    async saveReferral(userId, referrerId) {
      const { error } = await db.from("referrals").insert({ user_id: userId, referrer_id: referrerId });
      if (!error) return "ok";
      if (error.code === UNIQUE_VIOLATION) return "duplicate";
      console.error("saveReferral failed", error.message);
      return "error";
    },
    now: () => new Date(),
  });
});
