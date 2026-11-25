import { MAX_REFERRALS, ReferralInputSchema, type ReferralClaimRefusal, type ReferralResponse } from "@fit-check/schema/referral.ts";
import type { AuthResult } from "../_shared/auth.ts";

/** How long after signing up a user can still be counted as someone's referral. */
export const NEW_ACCOUNT_DAYS = 7;

/** The facts a claim is judged on, read by the handler; kept apart so the rule is tested without a database. */
export type ClaimFacts = {
  callerId: string;
  /** When the caller's account was created; null when it cannot be read (then the claim is refused). */
  callerCreatedAt: Date | null;
  /** The code's owner, or null when no user has that code. */
  referrerId: string | null;
  /** Whether the caller was already counted as someone's referral. */
  alreadyReferred: boolean;
  /** How many users the referrer has brought in so far. */
  referrerCount: number;
  now: Date;
};

/**
 * Whether a claim counts, and why not. Pure.
 * The order is the order of the user's own story: an unknown code first, then their own code, then a second
 * referral, then an account that is not new; a referrer at the cap last, because then the new user did nothing wrong.
 */
export function judgeClaim(f: ClaimFacts): "count" | ReferralClaimRefusal {
  if (f.referrerId === null) return "invalid_code";
  if (f.referrerId === f.callerId) return "self";
  if (f.alreadyReferred) return "already_referred";
  if (f.callerCreatedAt === null || f.now.getTime() - f.callerCreatedAt.getTime() > NEW_ACCOUNT_DAYS * 86_400_000) return "not_new";
  if (f.referrerCount >= MAX_REFERRALS) return "referrer_full";
  return "count";
}

const CODE_ALPHABET = "abcdefghijkmnpqrstuvwxyz23456789";

/**
 * A new random referral code: 8 characters from an alphabet without 0/o and 1/l, so a code read aloud or retyped
 * from a screenshot survives. Still matches REFERRAL_CODE_RE.
 */
export function newReferralCode(random: (n: number) => Uint8Array = (n) => crypto.getRandomValues(new Uint8Array(n))): string {
  return [...random(8)].map((b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join("");
}

/** What the handler needs from the outside world; index.ts passes the live ones, tests pass stubs. */
export interface ReferralDeps {
  authenticate(req: Request): Promise<AuthResult>;
  /** The caller's code, or null when they have none yet. */
  codeOf(userId: string): Promise<string | null>;
  /** Stores a code for the user; "taken" when another user has it, "error" on any other failure. */
  saveCode(userId: string, code: string): Promise<"ok" | "taken" | "error">;
  /** The user who owns `code`, or null. */
  ownerOfCode(code: string): Promise<string | null>;
  createdAt(userId: string): Promise<Date | null>;
  isReferred(userId: string): Promise<boolean>;
  countReferrals(referrerId: string): Promise<number>;
  /** Records the referral; "duplicate" when the user was referred meanwhile, "error" on any other failure. */
  saveReferral(userId: string, referrerId: string): Promise<"ok" | "duplicate" | "error">;
  now(): Date;
}

export const cors = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, x-client-info, apikey, content-type",
  "access-control-allow-methods": "POST, OPTIONS",
};
const json = (status: number, body: ReferralResponse) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...cors } });

/**
 * referral: a user's referral code, and claiming the code a new user arrived with (Roy, 2026-11-25: a bonus on the
 * allowance for bringing someone in, with a cap on referrals). No AI call; nothing is paid.
 *
 * Input (POST JSON, ReferralInputSchema): { action: "code" } returns the caller's code (made on first ask) with how
 * many users they referred and the cap; { action: "claim", code } counts the caller as that code's referral.
 * A claim counts only for an account at most NEW_ACCOUNT_DAYS old, not the referrer's own, never twice, and only
 * while the referrer is below MAX_REFERRALS.
 *
 * Responses: 200 { ok: true, ... } | 200 { ok: false, reason } with a ReferralClaimRefusal for a claim that does not
 * count | 400 bad_input | 401 unauthorized | 405 | 500 storage_error.
 */
export async function handleReferral(req: Request, deps: ReferralDeps): Promise<Response> {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json(405, { ok: false, reason: "method" });
  const auth = await deps.authenticate(req);
  if (!auth.ok) return json(401, { ok: false, reason: "unauthorized" });
  const userId = auth.userId;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json(400, { ok: false, reason: "bad_input" });
  }
  const parsed = ReferralInputSchema.safeParse(body);
  if (!parsed.success) return json(400, { ok: false, reason: "bad_input" });
  const input = parsed.data;

  if (input.action === "code") {
    let code = await deps.codeOf(userId);
    // A clash between two random 8-character codes is rare; three tries make a failure practically impossible.
    for (let attempt = 0; code === null && attempt < 3; attempt++) {
      const candidate = newReferralCode();
      const saved = await deps.saveCode(userId, candidate);
      if (saved === "ok") code = candidate;
      else if (saved === "error") return json(500, { ok: false, reason: "storage_error" });
      // "taken": a parallel request gave this user a code (read it back), or another user has this one (try again).
      else code = await deps.codeOf(userId);
    }
    if (code === null) return json(500, { ok: false, reason: "storage_error" });
    return json(200, { ok: true, action: "code", code, referred: await deps.countReferrals(userId), max: MAX_REFERRALS });
  }

  const referrerId = await deps.ownerOfCode(input.code);
  const [callerCreatedAt, alreadyReferred, referrerCount] = await Promise.all([
    deps.createdAt(userId),
    deps.isReferred(userId),
    referrerId === null ? Promise.resolve(0) : deps.countReferrals(referrerId),
  ]);
  const verdict = judgeClaim({ callerId: userId, callerCreatedAt, referrerId, alreadyReferred, referrerCount, now: deps.now() });
  if (verdict !== "count" || referrerId === null) return json(200, { ok: false, reason: verdict === "count" ? "invalid_code" : verdict });
  const saved = await deps.saveReferral(userId, referrerId);
  if (saved === "duplicate") return json(200, { ok: false, reason: "already_referred" });
  if (saved === "error") return json(500, { ok: false, reason: "storage_error" });
  return json(200, { ok: true, action: "claim" });
}
