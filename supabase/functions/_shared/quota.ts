import { createClient } from "@supabase/supabase-js";
import { MAX_REFERRALS, REFERRAL_BONUS } from "@fit-check/schema/referral.ts";
import { monthStart } from "./ai/cloudflare.ts";

/**
 * Per-user monthly allowances (Roy, 2026-11-25): every user but Roy gets a lean monthly allowance of AI spend and
 * background removals; Roy raises a user's allowance when they ask (the mcp `quota_set` tool). Roy himself has no
 * personal limit; the account-wide caps (`ai/budget.ts`, `ai/cloudflare.ts`) still hold for everyone, him included.
 */

/** AI spend a month for a user Roy has not raised: about 300 taggings, or 15 redraws, or 10 try-on images. */
export const DEFAULT_MONTHLY_USD = 0.5;
/** Background removals a month for a user Roy has not raised. Free, but they share Cloudflare's 2,400. */
export const DEFAULT_MONTHLY_CUTOUTS = 30;

export type Usage = { usd: number; cutouts: number };
/** What Roy granted on top of the defaults (a `user_quotas` row). */
export type Grant = { extra_usd: number; extra_cutouts: number };
/** A user's monthly limits; null means no personal limit (the owner, or the feature not switched on). */
export type Allowance = { usd: number; cutouts: number } | null;
/** What the allowance gates: an AI call that costs money, or a background removal. */
export type QuotaKind = "ai" | "cutout";

/**
 * The owner's user id, from the OWNER_USER_ID function secret. Null when unset: then no one has a personal limit,
 * which keeps Roy working before the secret exists; the account-wide caps still apply.
 */
export function ownerIdFromEnv(get: (name: string) => string | undefined = (n) => Deno.env.get(n)): string | null {
  const id = get("OWNER_USER_ID")?.trim();
  return id ? id : null;
}

/**
 * A user's monthly limits. Pure.
 * @param userId the caller
 * @param ownerId OWNER_USER_ID, or null when unset (then nobody is limited)
 * @param grant Roy's grant for this user, or null for the defaults
 * @param referrals users this one brought in (the `referrals` table); only the first MAX_REFERRALS add a bonus
 */
export function allowanceFor(userId: string, ownerId: string | null, grant: Grant | null, referrals = 0): Allowance {
  if (ownerId === null || userId === ownerId) return null;
  const counted = Math.min(MAX_REFERRALS, Math.max(0, Math.floor(referrals)));
  return {
    usd: round(DEFAULT_MONTHLY_USD + Math.max(0, grant?.extra_usd ?? 0) + counted * REFERRAL_BONUS.usd),
    cutouts: DEFAULT_MONTHLY_CUTOUTS + Math.max(0, Math.floor(grant?.extra_cutouts ?? 0)) + counted * REFERRAL_BONUS.cutouts,
  };
}

/**
 * Whether one more call of `kind` may start. Pure. Spend below the limit, not spend plus a price: the most a month
 * can pass a limit by is one call (a few cents at most). Unknown usage (null) never allows a limited user a call.
 */
export function quotaAllows(kind: QuotaKind, usage: Usage | null, allowance: Allowance): boolean {
  if (allowance === null) return true;
  if (usage === null) return false;
  return kind === "ai" ? usage.usd < allowance.usd : usage.cutouts < allowance.cutouts;
}

/**
 * How much of the month's allowance is used, 0-100, as the larger of the two shares: the bar the user sees fills
 * with whichever runs out first. Null without a personal limit. Pure.
 */
export function percentUsed(usage: Usage, allowance: Allowance): number | null {
  if (allowance === null) return null;
  const share = Math.max(allowance.usd > 0 ? usage.usd / allowance.usd : 1, allowance.cutouts > 0 ? usage.cutouts / allowance.cutouts : 1);
  return Math.min(100, Math.round(share * 100));
}

const round = (usd: number) => Math.round(usd * 100) / 100;

/** The reads the allowance needs, injectable so the wiring is tested without a database. */
export type QuotaDeps = {
  ownerId: () => string | null;
  /** This user's `user_quotas` row; null when there is none; throws when it cannot be read. */
  grant: (userId: string) => Promise<Grant | null>;
  /** This user's spend and successful background removals since `since`; null when they cannot be read. */
  usage: (userId: string, since: Date) => Promise<Usage | null>;
  /** How many users this one referred; 0 when it cannot be read (a bonus is never assumed). */
  referrals: (userId: string) => Promise<number>;
};

function serviceClient() {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  return url && key ? createClient(url, key, { auth: { persistSession: false } }) : null;
}

const liveDeps: QuotaDeps = {
  ownerId: () => ownerIdFromEnv(),
  async grant(userId) {
    const db = serviceClient();
    if (!db) throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing");
    const { data, error } = await db.from("user_quotas").select("extra_usd, extra_cutouts").eq("user_id", userId).maybeSingle();
    if (error) throw new Error(error.message);
    return data ? { extra_usd: Number(data.extra_usd), extra_cutouts: Number(data.extra_cutouts) } : null;
  },
  async usage(userId, since) {
    const db = serviceClient();
    if (!db) return null;
    const { data, error } = await db.from("ai_calls").select("cost_usd, task, ok").eq("user_id", userId).gte("created_at", since.toISOString());
    if (error) {
      console.error("usage read failed", error.message);
      return null;
    }
    let usd = 0;
    let cutouts = 0;
    for (const row of data ?? []) {
      usd += Number(row.cost_usd ?? 0);
      // A failed removal produced nothing for the user, so it does not use up their allowance.
      if (row.task === "cutout" && row.ok) cutouts++;
    }
    return { usd, cutouts };
  },
  async referrals(userId) {
    const db = serviceClient();
    if (!db) return 0;
    const { count, error } = await db.from("referrals").select("user_id", { count: "exact", head: true }).eq("referrer_id", userId);
    if (error) console.error("referrals read failed", error.message);
    return error ? 0 : count ?? 0;
  },
};

/** A user's allowance and this month's usage, as the checks and the usage screen read them. */
export type QuotaState = { owner: boolean; allowance: Allowance; usage: Usage | null };

/**
 * Reads one user's allowance and this calendar month's (UTC) usage. Never throws.
 * Failure modes: a grant that cannot be read counts as no grant (the defaults, never more); usage that cannot be
 * read is null, which quotaAllows treats as used up for a limited user. Usage is not read for an unlimited user.
 */
export async function quotaState(userId: string, now: Date = new Date(), deps: QuotaDeps = liveDeps): Promise<QuotaState> {
  const ownerId = deps.ownerId();
  const owner = ownerId !== null && ownerId === userId;
  if (ownerId === null || owner) return { owner, allowance: null, usage: null };
  let grant: Grant | null = null;
  try {
    grant = await deps.grant(userId);
  } catch (error) {
    console.error("grant read failed", error instanceof Error ? error.message : String(error));
  }
  const [usage, referrals] = await Promise.all([deps.usage(userId, monthStart(now)), deps.referrals(userId)]);
  return { owner, allowance: allowanceFor(userId, ownerId, grant, referrals), usage };
}

/**
 * The check every Edge Function runs before an AI call or a background removal for a user. Never throws.
 * Callers answer `user_monthly_limit` when it is false.
 */
export async function userAllows(userId: string, kind: QuotaKind, now: Date = new Date(), deps: QuotaDeps = liveDeps): Promise<boolean> {
  const state = await quotaState(userId, now, deps);
  return quotaAllows(kind, state.usage, state.allowance);
}
