import { MAX_REFERRALS, REFERRAL_CODE_RE } from "@fit-check/schema/referral.ts";
import { handleReferral, judgeClaim, NEW_ACCOUNT_DAYS, newReferralCode, type ReferralDeps } from "./handler.ts";

function assertEquals(actual: unknown, expected: unknown) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

const NOW = new Date("2026-11-25T12:00:00Z");
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000);
const base = { callerId: "new", callerCreatedAt: daysAgo(1), referrerId: "roy", alreadyReferred: false, referrerCount: 0, now: NOW };

Deno.test("judgeClaim: a new account with someone else's code counts", () => {
  assertEquals(judgeClaim(base), "count");
  assertEquals(judgeClaim({ ...base, callerCreatedAt: daysAgo(NEW_ACCOUNT_DAYS) }), "count");
});

Deno.test("judgeClaim: unknown code, own code, second referral, old account, full referrer", () => {
  assertEquals(judgeClaim({ ...base, referrerId: null }), "invalid_code");
  assertEquals(judgeClaim({ ...base, referrerId: "new" }), "self");
  assertEquals(judgeClaim({ ...base, alreadyReferred: true }), "already_referred");
  assertEquals(judgeClaim({ ...base, callerCreatedAt: daysAgo(NEW_ACCOUNT_DAYS + 1) }), "not_new");
  assertEquals(judgeClaim({ ...base, callerCreatedAt: null }), "not_new");
  assertEquals(judgeClaim({ ...base, referrerCount: MAX_REFERRALS }), "referrer_full");
});

Deno.test("newReferralCode matches the table's check and avoids look-alike characters", () => {
  for (let i = 0; i < 200; i++) {
    const code = newReferralCode();
    if (!REFERRAL_CODE_RE.test(code) || /[01lo]/.test(code)) throw new Error(`bad code ${code}`);
  }
});

/** An in-memory store behind the handler. */
function world(opts: { users?: Record<string, Date>; codes?: Record<string, string>; referrals?: Record<string, string>; failSaves?: boolean } = {}) {
  const users = opts.users ?? { roy: daysAgo(30), new: daysAgo(1) };
  const codes = opts.codes ?? { roy: "abcd2345" };
  const referrals = opts.referrals ?? {};
  const deps: ReferralDeps = {
    authenticate: (req) => {
      const id = (req.headers.get("authorization") ?? "").replace("Bearer ", "");
      return Promise.resolve(id in users ? { ok: true, userId: id } : { ok: false, detail: "no user" });
    },
    codeOf: (id) => Promise.resolve(codes[id] ?? null),
    saveCode: (id, code) => {
      if (opts.failSaves) return Promise.resolve("error");
      if (Object.values(codes).includes(code) || id in codes) return Promise.resolve("taken");
      codes[id] = code;
      return Promise.resolve("ok");
    },
    ownerOfCode: (code) => Promise.resolve(Object.entries(codes).find(([, c]) => c === code)?.[0] ?? null),
    createdAt: (id) => Promise.resolve(users[id] ?? null),
    isReferred: (id) => Promise.resolve(id in referrals),
    countReferrals: (id) => Promise.resolve(Object.values(referrals).filter((r) => r === id).length),
    saveReferral: (id, referrer) => {
      if (id in referrals) return Promise.resolve("duplicate");
      referrals[id] = referrer;
      return Promise.resolve("ok");
    },
    now: () => NOW,
  };
  return { deps, codes, referrals };
}
const post = (user: string, body: unknown) =>
  new Request("https://x/functions/v1/referral", { method: "POST", headers: { authorization: `Bearer ${user}`, "content-type": "application/json" }, body: JSON.stringify(body) });
const call = async (w: ReturnType<typeof world>, user: string, body: unknown) => {
  const res = await handleReferral(post(user, body), w.deps);
  return { status: res.status, body: await res.json() };
};

Deno.test("code: made once on first ask, then the same code, with the count and the cap", async () => {
  const w = world({ codes: {} });
  const first = await call(w, "new", { action: "code" });
  assertEquals([first.status, first.body.ok, REFERRAL_CODE_RE.test(first.body.code), first.body.referred, first.body.max], [200, true, true, 0, MAX_REFERRALS]);
  const again = await call(w, "new", { action: "code" });
  assertEquals(again.body.code, first.body.code);
});

Deno.test("claim: counts once, and a second claim is already_referred", async () => {
  const w = world();
  assertEquals((await call(w, "new", { action: "claim", code: "ABCD2345" })).body, { ok: true, action: "claim" });
  assertEquals(w.referrals, { new: "roy" });
  assertEquals((await call(w, "new", { action: "claim", code: "abcd2345" })).body, { ok: false, reason: "already_referred" });
});

Deno.test("claim refusals reach the app as reasons; bad input and no token are typed errors", async () => {
  const w = world();
  assertEquals((await call(w, "roy", { action: "claim", code: "abcd2345" })).body.reason, "self");
  assertEquals((await call(w, "new", { action: "claim", code: "zzzz9999" })).body.reason, "invalid_code");
  assertEquals((await call(w, "new", { action: "claim", code: "short" })).status, 400);
  assertEquals((await call(w, "new", { action: "claim", code: "abcd2345", extra: 1 })).status, 400);
  assertEquals((await call(w, "nobody", { action: "code" })).status, 401);
  const failing = world({ codes: {}, failSaves: true });
  assertEquals((await call(failing, "new", { action: "code" })).body, { ok: false, reason: "storage_error" });
});
