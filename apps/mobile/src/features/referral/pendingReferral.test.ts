import { beforeEach, describe, expect, it, vi } from "vitest";

const store = new Map<string, string>();
vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: (k: string) => Promise.resolve(store.get(k) ?? null),
    setItem: (k: string, v: string) => Promise.resolve(void store.set(k, v)),
    removeItem: (k: string) => Promise.resolve(void store.delete(k)),
  },
}));

const { claimPendingReferral, rememberReferral, takeReferral } = await import("./pendingReferral");

describe("pending referral", () => {
  beforeEach(() => store.clear());

  it("keeps a well-formed code, normalised, and gives it back once", async () => {
    await rememberReferral("  ABCD2345 ");
    expect(await takeReferral()).toBe("abcd2345");
    expect(await takeReferral()).toBeNull();
  });

  it("ignores a malformed code", async () => {
    await rememberReferral("not-a-code");
    expect(await takeReferral()).toBeNull();
  });

  it("claims once; a refusal ends it, a network failure keeps it for the next sign-in", async () => {
    const claim = vi.fn().mockResolvedValueOnce({ ok: false, reason: "network" }).mockResolvedValueOnce({ ok: false, reason: "self" });
    await rememberReferral("abcd2345");
    await claimPendingReferral(claim);
    await claimPendingReferral(claim);
    await claimPendingReferral(claim);
    expect(claim).toHaveBeenCalledTimes(2);
    expect(claim).toHaveBeenCalledWith("abcd2345");
  });
});
