import { describe, expect, it } from "vitest";
import { meterOf, UsageResponseSchema } from "./usage.ts";

describe("meterOf", () => {
  it("rounds the share and caps it at 100", () => {
    expect(meterOf(0.125, 0.5)).toEqual({ used: 0.13, limit: 0.5, percent: 25 });
    expect(meterOf(9, 8)).toEqual({ used: 9, limit: 8, percent: 100 });
  });
  it("keeps an unknown figure unknown instead of showing an empty month", () => {
    expect(meterOf(null, 80)).toEqual({ used: null, limit: 80, percent: null });
  });
});

describe("UsageResponseSchema", () => {
  it("accepts a limited user, the owner, and a failure", () => {
    const meter = meterOf(0.2, 0.5);
    expect(UsageResponseSchema.safeParse({ ok: true, owner: false, me: { ai_usd: meter, cutouts: meterOf(3, 30), percent: 40 }, account: null }).success).toBe(true);
    expect(
      UsageResponseSchema.safeParse({
        ok: true,
        owner: true,
        me: { ai_usd: null, cutouts: null, percent: null },
        account: { google_usd: meterOf(5.2, 8), anthropic_usd: meterOf(0.9, 80), cutouts: meterOf(1, 2400) },
      }).success,
    ).toBe(true);
    expect(UsageResponseSchema.safeParse({ ok: false, reason: "unauthorized" }).success).toBe(true);
  });
  it("rejects a percent outside 0-100", () => {
    expect(UsageResponseSchema.safeParse({ ok: true, owner: false, me: { ai_usd: null, cutouts: null, percent: 140 }, account: null }).success).toBe(false);
  });
});
