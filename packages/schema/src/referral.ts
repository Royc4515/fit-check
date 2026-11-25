import { z } from "zod";

/** A referral code: 8 lowercase letters or digits, as the `referral` function makes them and the table checks. */
export const REFERRAL_CODE_RE = /^[a-z0-9]{8}$/;
export const ReferralCodeSchema = z.string().trim().toLowerCase().regex(REFERRAL_CODE_RE);

/** Referrals that add to a referrer's allowance; more are recorded but add nothing (Roy: a cap on referrals). */
export const MAX_REFERRALS = 4;
/** What each counted referral adds to the referrer's monthly allowance. */
export const REFERRAL_BONUS = { usd: 0.25, cutouts: 10 } as const;

/** The `referral` function's input: read (or create) my code, or claim the code I arrived with. */
export const ReferralInputSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("code") }).strict(),
  z.object({ action: z.literal("claim"), code: ReferralCodeSchema }).strict(),
]);
export type ReferralInput = z.infer<typeof ReferralInputSchema>;

/**
 * Why a claim was not counted. All but `invalid_code` are expected outcomes, not errors: the app drops the stored
 * code and says nothing.
 */
export const REFERRAL_CLAIM_REFUSALS = ["invalid_code", "self", "already_referred", "not_new", "referrer_full"] as const;
export type ReferralClaimRefusal = (typeof REFERRAL_CLAIM_REFUSALS)[number];

export const ReferralResponseSchema = z.union([
  z.object({ ok: z.literal(true), action: z.literal("code"), code: ReferralCodeSchema, referred: z.number().int().min(0), max: z.number().int().positive() }),
  z.object({ ok: z.literal(true), action: z.literal("claim") }),
  z.object({ ok: z.literal(false), reason: z.string() }),
]);
export type ReferralResponse = z.infer<typeof ReferralResponseSchema>;
