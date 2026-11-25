import { removeBackground, type BackgroundDeps } from "./background.ts";
import { cloudflareAllows, cutoutCloudflare, monthStart, MONTHLY_CLOUDFLARE_CUTOUTS } from "./cloudflare.ts";
import type { CutoutResult } from "./modal.ts";
import type { AiLogEntry } from "./types.ts";

function assertEquals(actual: unknown, expected: unknown) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

const bytes = (s: string) => new TextEncoder().encode(s);
const text = (b: Uint8Array) => new TextDecoder().decode(b);
const entry = (provider: AiLogEntry["provider"], ok: boolean, error?: string): AiLogEntry => ({
  provider,
  model: provider,
  task: "cutout",
  latency_ms: 1,
  ok,
  ...(error ? { error } : {}),
});
const done = (provider: AiLogEntry["provider"], isolated: boolean): CutoutResult => ({
  ok: true,
  cutout: bytes(`${provider}-cutout`),
  thumb: bytes(`${provider}-thumb`),
  isolated,
  log: entry(provider, true),
});
const failed = (provider: AiLogEntry["provider"], error: string): CutoutResult => ({ ok: false, notConfigured: false, log: entry(provider, false, error) });
const unset = (provider: AiLogEntry["provider"]): CutoutResult => ({ ok: false, notConfigured: true, log: entry(provider, false, "unset") });

/** Providers answering fixed results, recording who was called. */
function deps(cf: CutoutResult, modal: CutoutResult, used: number | null = 0) {
  const called: string[] = [];
  const d: BackgroundDeps = {
    cloudflare: () => (called.push("cloudflare"), Promise.resolve(cf)),
    modal: (_i, _m, isolate) => (called.push(`modal:${isolate}`), Promise.resolve(modal)),
    cloudflareUsedThisMonth: () => Promise.resolve(used),
  };
  return { d, called };
}
function logger() {
  const logged: string[] = [];
  return { logged, log: (e: AiLogEntry) => (logged.push(`${e.provider}:${e.ok}`), Promise.resolve()) };
}

Deno.test("Cloudflare first: on success Modal is never called and one call is logged", async () => {
  const { d, called } = deps(done("cloudflare", false), done("modal", true));
  const { logged, log } = logger();
  const out = await removeBackground(bytes("img"), "image/jpeg", true, log, d);
  assertEquals(out.ok && text(out.cutout), "cloudflare-cutout");
  assertEquals(out.ok && out.isolated, false);
  assertEquals(called, ["cloudflare"]);
  assertEquals(logged, ["cloudflare:true"]);
});

Deno.test("a Cloudflare failure falls back to Modal, with isolate passed through, and both calls are logged", async () => {
  const { d, called } = deps(failed("cloudflare", "HTTP 502"), done("modal", true));
  const { logged, log } = logger();
  const out = await removeBackground(bytes("img"), "image/jpeg", false, log, d);
  assertEquals(out.ok && text(out.thumb), "modal-thumb");
  assertEquals(called, ["cloudflare", "modal:false"]);
  assertEquals(logged, ["cloudflare:false", "modal:true"]);
});

Deno.test("past the monthly cap (or an unreadable count) Cloudflare is not called", async () => {
  for (const used of [MONTHLY_CLOUDFLARE_CUTOUTS, null]) {
    const { d, called } = deps(done("cloudflare", false), done("modal", true), used);
    const out = await removeBackground(bytes("img"), "image/jpeg", true, logger().log, d);
    assertEquals(out.ok && text(out.cutout), "modal-cutout");
    assertEquals(called, ["modal:true"]);
  }
});

Deno.test("capped with no Modal says so: cutout_monthly_limit, and nothing is logged", async () => {
  const { d } = deps(done("cloudflare", false), unset("modal"), MONTHLY_CLOUDFLARE_CUTOUTS);
  const { logged, log } = logger();
  const out = await removeBackground(bytes("img"), "image/jpeg", true, log, d);
  assertEquals(!out.ok && out.reason, "cutout_monthly_limit");
  assertEquals(logged, []);
});

Deno.test("nothing set up is not_configured and logs nothing; a real failure is ai_failed with both errors", async () => {
  const none = await removeBackground(bytes("img"), "image/jpeg", true, logger().log, deps(unset("cloudflare"), unset("modal")).d);
  assertEquals(!none.ok && none.reason, "not_configured");

  const { logged, log } = logger();
  const both = await removeBackground(bytes("img"), "image/jpeg", true, log, deps(failed("cloudflare", "HTTP 502"), failed("modal", "HTTP 429")).d);
  assertEquals(!both.ok && both.reason, "ai_failed");
  assertEquals(!both.ok && both.error, "cloudflare: HTTP 502; modal: HTTP 429");
  assertEquals(logged, ["cloudflare:false", "modal:false"]);

  const cfOnly = await removeBackground(bytes("img"), "image/jpeg", true, logger().log, deps(failed("cloudflare", "HTTP 401"), unset("modal")).d);
  assertEquals(!cfOnly.ok && cfOnly.reason, "ai_failed");
});

Deno.test("cloudflareAllows: below the cap only, and never on an unknown count", () => {
  assertEquals(cloudflareAllows(0), true);
  assertEquals(cloudflareAllows(MONTHLY_CLOUDFLARE_CUTOUTS - 1), true);
  assertEquals(cloudflareAllows(MONTHLY_CLOUDFLARE_CUTOUTS), false);
  assertEquals(cloudflareAllows(null), false);
  assertEquals(monthStart(new Date("2026-11-25T23:59:00Z")).toISOString(), "2026-11-01T00:00:00.000Z");
});

/** A Worker in memory: answers each request from a queue of responses and records what was sent. */
function fakeWorker(responses: (Response | Error)[]) {
  const sent: { url: string; auth: string | null; type: string | null; body: string }[] = [];
  const impl: typeof fetch = async (input, init) => {
    const body = init?.body instanceof Blob ? await init.body.text() : "";
    const headers = new Headers(init?.headers);
    sent.push({ url: String(input), auth: headers.get("authorization"), type: headers.get("content-type"), body });
    const next = responses.shift();
    if (!next) throw new Error("no more responses");
    if (next instanceof Error) throw next;
    return next;
  };
  return { impl, sent };
}
const ENV: Record<string, string> = { CLOUDFLARE_CUTOUT_URL: "https://cut.example.workers.dev/", CLOUDFLARE_CUTOUT_TOKEN: "tok" };
const env = (n: string) => ENV[n];

Deno.test("cutoutCloudflare: crop in, cutout out, then the cutout in for its thumbnail", async () => {
  const w = fakeWorker([new Response("CUT"), new Response("THUMB")]);
  const out = await cutoutCloudflare(bytes("crop"), "image/jpeg", w.impl, env);
  assertEquals(out.ok && [text(out.cutout), text(out.thumb), out.isolated], ["CUT", "THUMB", false]);
  assertEquals(w.sent, [
    { url: "https://cut.example.workers.dev/", auth: "Bearer tok", type: "image/jpeg", body: "crop" },
    { url: "https://cut.example.workers.dev/?op=thumb", auth: "Bearer tok", type: "image/png", body: "CUT" },
  ]);
  assertEquals(out.log.provider === "cloudflare" && out.log.ok && out.log.cost_usd, 0);
});

Deno.test("cutoutCloudflare retries a fast failure once, never a timeout or a 429", async () => {
  const flaky = fakeWorker([new Response("Error code: 1104", { status: 502 }), new Response("CUT"), new Response("THUMB")]);
  assertEquals((await cutoutCloudflare(bytes("crop"), "image/png", flaky.impl, env)).ok, true);
  const down = fakeWorker([new Error("reset"), new Error("reset")]);
  const failedTwice = await cutoutCloudflare(bytes("crop"), "image/png", down.impl, env);
  assertEquals(!failedTwice.ok && !failedTwice.notConfigured && down.sent.length, 2);
  const slow = fakeWorker([new DOMException("slow", "TimeoutError")]);
  const timedOut = await cutoutCloudflare(bytes("crop"), "image/png", slow.impl, env);
  assertEquals([timedOut.ok, slow.sent.length, timedOut.log.error], [false, 1, "timeout after 25000 ms"]);
  const quota = fakeWorker([new Response("9422", { status: 429 })]);
  const refused = await cutoutCloudflare(bytes("crop"), "image/png", quota.impl, env);
  assertEquals([refused.ok, quota.sent.length, refused.log.error], [false, 1, "HTTP 429: 9422"]);
});

Deno.test("cutoutCloudflare: unset env is notConfigured without a request; a failed thumbnail fails the cutout", async () => {
  const w = fakeWorker([]);
  const out = await cutoutCloudflare(bytes("crop"), "image/png", w.impl, () => undefined);
  assertEquals([!out.ok && out.notConfigured, w.sent.length], [true, 0]);
  const t = fakeWorker([new Response("CUT"), new Response("no", { status: 502 })]);
  const noThumb = await cutoutCloudflare(bytes("crop"), "image/png", t.impl, env);
  assertEquals([noThumb.ok, noThumb.log.error], [false, "thumb HTTP 502: no"]);
});
