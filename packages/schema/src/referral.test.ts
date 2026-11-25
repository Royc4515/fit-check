import { describe, expect, it } from "vitest";
import { ReferralInputSchema, ReferralResponseSchema } from "./referral.ts";

describe("ReferralInputSchema", () => {
  it("accepts the two actions and normalises the code", () => {
    expect(ReferralInputSchema.parse({ action: "code" })).toEqual({ action: "code" });
    expect(ReferralInputSchema.parse({ action: "claim", code: " ABCD2345 " })).toEqual({ action: "claim", code: "abcd2345" });
  });
  it("rejects a malformed code and extra fields", () => {
    expect(ReferralInputSchema.safeParse({ action: "claim", code: "abc" }).success).toBe(false);
    expect(ReferralInputSchema.safeParse({ action: "code", code: "abcd2345" }).success).toBe(false);
  });
});

describe("ReferralResponseSchema", () => {
  it("parses a code answer, a counted claim and a refusal", () => {
    expect(ReferralResponseSchema.safeParse({ ok: true, action: "code", code: "abcd2345", referred: 1, max: 4 }).success).toBe(true);
    expect(ReferralResponseSchema.safeParse({ ok: true, action: "claim" }).success).toBe(true);
    expect(ReferralResponseSchema.safeParse({ ok: false, reason: "not_new" }).success).toBe(true);
  });
});
