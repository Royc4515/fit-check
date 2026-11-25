import {
  allowanceFor,
  DEFAULT_MONTHLY_CUTOUTS,
  DEFAULT_MONTHLY_USD,
  ownerIdFromEnv,
  percentUsed,
  quotaAllows,
  quotaState,
  userAllows,
  type QuotaDeps,
  type Usage,
} from "./quota.ts";

function assertEquals(actual: unknown, expected: unknown) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

const OWNER = "owner-id";
const DANA = "dana-id";
const NOW = new Date("2026-11-25T12:00:00Z");

Deno.test("the owner, and everyone while OWNER_USER_ID is unset, has no personal limit", () => {
  assertEquals(allowanceFor(OWNER, OWNER, null), null);
  assertEquals(allowanceFor(DANA, null, null), null);
  assertEquals(ownerIdFromEnv(() => undefined), null);
  assertEquals(ownerIdFromEnv(() => "  "), null);
  assertEquals(ownerIdFromEnv(() => ` ${OWNER} `), OWNER);
});

Deno.test("other users get the defaults plus Roy's grant, never less than the defaults", () => {
  assertEquals(allowanceFor(DANA, OWNER, null), { usd: DEFAULT_MONTHLY_USD, cutouts: DEFAULT_MONTHLY_CUTOUTS });
  assertEquals(allowanceFor(DANA, OWNER, { extra_usd: 2, extra_cutouts: 20 }), { usd: 2.5, cutouts: 50 });
  assertEquals(allowanceFor(DANA, OWNER, { extra_usd: -5, extra_cutouts: -10 }), { usd: DEFAULT_MONTHLY_USD, cutouts: DEFAULT_MONTHLY_CUTOUTS });
});

Deno.test("each referral adds its bonus, up to the cap, and never below zero", () => {
  assertEquals(allowanceFor(DANA, OWNER, null, 1), { usd: 0.75, cutouts: 40 });
  assertEquals(allowanceFor(DANA, OWNER, null, 4), { usd: 1.5, cutouts: 70 });
  assertEquals(allowanceFor(DANA, OWNER, null, 9), { usd: 1.5, cutouts: 70 });
  assertEquals(allowanceFor(DANA, OWNER, null, -3), { usd: DEFAULT_MONTHLY_USD, cutouts: DEFAULT_MONTHLY_CUTOUTS });
  assertEquals(allowanceFor(OWNER, OWNER, null, 4), null);
});

Deno.test("quotaAllows: each kind against its own limit, unknown usage is used up, no limit always allows", () => {
  const limit = { usd: 0.5, cutouts: 30 };
  const used = (usd: number, cutouts: number): Usage => ({ usd, cutouts });
  assertEquals(quotaAllows("ai", used(0.49, 99), limit), true);
  assertEquals(quotaAllows("ai", used(0.5, 0), limit), false);
  assertEquals(quotaAllows("cutout", used(9, 29), limit), true);
  assertEquals(quotaAllows("cutout", used(0, 30), limit), false);
  assertEquals(quotaAllows("ai", null, limit), false);
  assertEquals(quotaAllows("ai", null, null), true);
});

Deno.test("percentUsed is the fuller of the two shares, capped at 100", () => {
  const limit = { usd: 0.5, cutouts: 30 };
  assertEquals(percentUsed({ usd: 0.1, cutouts: 15 }, limit), 50);
  assertEquals(percentUsed({ usd: 0.4, cutouts: 3 }, limit), 80);
  assertEquals(percentUsed({ usd: 3, cutouts: 0 }, limit), 100);
  assertEquals(percentUsed({ usd: 3, cutouts: 0 }, null), null);
});

/** Deps answering fixed values, recording which reads ran. */
function deps(ownerId: string | null, grant: QuotaDeps["grant"], usage: Usage | null, referrals = 0) {
  const reads: string[] = [];
  const d: QuotaDeps = {
    ownerId: () => ownerId,
    grant: (id) => (reads.push(`grant:${id}`), grant(id)),
    usage: (id, since) => (reads.push(`usage:${id}:${since.toISOString()}`), Promise.resolve(usage)),
    referrals: (id) => (reads.push(`referrals:${id}`), Promise.resolve(referrals)),
  };
  return { d, reads };
}

Deno.test("quotaState: the owner is never read; others are read from the 1st of the month", async () => {
  const owner = deps(OWNER, () => Promise.resolve(null), { usd: 100, cutouts: 1000 });
  assertEquals(await quotaState(OWNER, NOW, owner.d), { owner: true, allowance: null, usage: null });
  assertEquals(owner.reads, []);

  const dana = deps(OWNER, () => Promise.resolve({ extra_usd: 1, extra_cutouts: 0 }), { usd: 0.2, cutouts: 4 });
  assertEquals(await quotaState(DANA, NOW, dana.d), { owner: false, allowance: { usd: 1.5, cutouts: 30 }, usage: { usd: 0.2, cutouts: 4 } });
  assertEquals(dana.reads, [`grant:${DANA}`, `usage:${DANA}:2026-11-01T00:00:00.000Z`, `referrals:${DANA}`]);
  const referrer = deps(OWNER, () => Promise.resolve(null), { usd: 0, cutouts: 0 }, 2);
  assertEquals((await quotaState(DANA, NOW, referrer.d)).allowance, { usd: 1, cutouts: 50 });
});

Deno.test("userAllows fails safe: an unreadable grant means the defaults, unreadable usage means no call", async () => {
  const brokenGrant = deps(OWNER, () => Promise.reject(new Error("down")), { usd: 0.6, cutouts: 0 });
  assertEquals(await userAllows(DANA, "ai", NOW, brokenGrant.d), false);
  assertEquals(await userAllows(DANA, "cutout", NOW, brokenGrant.d), true);
  const noUsage = deps(OWNER, () => Promise.resolve(null), null);
  assertEquals(await userAllows(DANA, "cutout", NOW, noUsage.d), false);
  assertEquals(await userAllows(OWNER, "ai", NOW, noUsage.d), true);
});
