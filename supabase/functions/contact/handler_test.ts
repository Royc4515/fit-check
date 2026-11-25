import { composeEmail, CONTACT_TO, DAILY_ALL_USERS, DAILY_PER_USER, handleContact, sendWithResend, type ContactDeps } from "./handler.ts";

function assertEquals(actual: unknown, expected: unknown) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}
function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

const NOW = new Date("2026-11-25T12:00:00Z");
const DANA = { id: "dana-id", email: "dana@example.com", name: "Dana" };

Deno.test("composeEmail: kind and sender in the subject; usage, message and the next step in the body", () => {
  const usage = { percent: 80, usd: 0.4, usdLimit: 0.5, cutouts: 12, cutoutLimit: 30 };
  const mail = composeEmail({ kind: "more_quota", message: "אני מוסיפה את כל הארון" }, DANA, usage, NOW);
  assertEquals(mail.subject, "[Fit Check] בקשה להגדלת מכסה · dana@example.com");
  assertEquals(mail.replyTo, "dana@example.com");
  for (const part of ["מאת: Dana <dana@example.com>", "שימוש החודש: 80% (AI: $0.40 מתוך $0.50, הסרות רקע: 12 מתוך 30)", "אני מוסיפה את כל הארון", "quota_set עבור dana@example.com"]) {
    assert(mail.text.includes(part), `missing: ${part}`);
  }
  const other = composeEmail({ kind: "idea", message: "x" }, { id: "u", email: null, name: null }, null, NOW);
  assert(other.subject.endsWith("· u") && other.replyTo === null && other.text.includes("ללא מכסה אישית"), other.text);
});

/** Stubs recording what was stored and sent. */
function world(opts: { mine?: number | null; all?: number | null; send?: boolean; saveFails?: boolean } = {}) {
  const saved: unknown[] = [];
  const sent: { subject: string }[] = [];
  const emailed: number[] = [];
  const deps: ContactDeps = {
    authenticate: (req) => Promise.resolve(req.headers.get("authorization") === "Bearer good" ? { ok: true, userId: DANA.id } : { ok: false, detail: "no" }),
    countSince: (userId) => Promise.resolve(userId === null ? (opts.all === undefined ? 0 : opts.all) : opts.mine === undefined ? 0 : opts.mine),
    sender: () => Promise.resolve(DANA),
    usage: () => Promise.resolve(null),
    save: (_id, input) => (saved.push(input), Promise.resolve(opts.saveFails ? null : 7)),
    sendEmail: (email) => (sent.push(email), Promise.resolve(opts.send ?? true)),
    markEmailed: (id) => (emailed.push(id), Promise.resolve()),
    now: () => NOW,
  };
  return { deps, saved, sent, emailed };
}
const post = (body: unknown, token = "good") =>
  new Request("https://x/functions/v1/contact", { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify(body) });
const call = async (w: ReturnType<typeof world>, body: unknown, token?: string) => {
  const res = await handleContact(post(body, token), w.deps);
  return { status: res.status, body: await res.json() };
};

Deno.test("a request is stored, emailed and marked; a failed email still succeeds, unmarked", async () => {
  const w = world();
  assertEquals((await call(w, { kind: "problem", message: "  the cutout failed  " })).body, { ok: true, emailed: true });
  assertEquals([w.saved, w.emailed, w.sent.length], [[{ kind: "problem", message: "the cutout failed" }], [7], 1]);
  const offline = world({ send: false });
  assertEquals((await call(offline, { kind: "idea", message: "x" })).body, { ok: true, emailed: false });
  assertEquals(offline.emailed, []);
});

Deno.test("limits: per user, for everyone, and an uncountable day; nothing stored or sent", async () => {
  for (const opts of [{ mine: DAILY_PER_USER }, { all: DAILY_ALL_USERS }, { mine: null }]) {
    const w = world(opts);
    const r = await call(w, { kind: "other", message: "x" });
    assertEquals([r.status, r.body.reason, w.saved.length, w.sent.length], [429, "daily_limit", 0, 0]);
  }
});

Deno.test("bad input, no token and a failed save are typed errors", async () => {
  const w = world();
  assertEquals((await call(w, { kind: "spam", message: "x" })).status, 400);
  assertEquals((await call(w, { kind: "idea", message: "   " })).status, 400);
  assertEquals((await call(w, { kind: "idea", message: "x".repeat(1001) })).status, 400);
  assertEquals((await call(w, { kind: "idea", message: "x", to: "a@b.c" })).status, 400);
  assertEquals((await call(w, { kind: "idea", message: "x" }, "bad")).status, 401);
  const broken = world({ saveFails: true });
  assertEquals((await call(broken, { kind: "idea", message: "x" })).body, { ok: false, reason: "storage_error" });
  assertEquals(broken.sent.length, 0);
});

Deno.test("sendWithResend: no key sends nothing; a request goes to Roy from Resend's address", async () => {
  let requests = 0;
  const fake: typeof fetch = async (_url, init) => {
    requests++;
    const body = JSON.parse(String(init?.body));
    assertEquals([body.from, body.to, body.reply_to], ["Fit Check <onboarding@resend.dev>", [CONTACT_TO], "dana@example.com"]);
    return new Response("{}", { status: 200 });
  };
  assertEquals(await sendWithResend({ subject: "s", text: "t", replyTo: "dana@example.com" }, undefined, fake), false);
  assertEquals(await sendWithResend({ subject: "s", text: "t", replyTo: "dana@example.com" }, "re_key", fake), true);
  assertEquals(requests, 1);
  const refusing: typeof fetch = () => Promise.resolve(new Response("quota", { status: 429 }));
  assertEquals(await sendWithResend({ subject: "s", text: "t", replyTo: null }, "re_key", refusing), false);
});
