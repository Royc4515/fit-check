import { ReferralResponseSchema, type ReferralResponse } from "@fit-check/schema";
import { invoke } from "./intake";

/**
 * Counts the signed-in user as the referral of the user who owns `code` (the `referral` Edge Function decides whether
 * it counts: a new account, someone else's code, once). Never throws; a refusal is a reason, not an error.
 */
export function claimReferral(code: string): Promise<ReferralResponse> {
  return invoke({ action: "claim", code }, ReferralResponseSchema, "referral") as Promise<ReferralResponse>;
}

/** The signed-in user's own referral code (made on first ask), how many users they referred, and the cap. */
export function fetchReferralCode(): Promise<ReferralResponse> {
  return invoke({ action: "code" }, ReferralResponseSchema, "referral") as Promise<ReferralResponse>;
}
