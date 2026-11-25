import type { CutoutResult } from "./modal.ts";
import type { AiLogEntry } from "./types.ts";

/** The model name written to ai_calls, and the key the monthly count below is taken by. */
export const CLOUDFLARE_CUTOUT_MODEL = "cf-images-segment-foreground";

/**
 * Cutouts allowed per calendar month (UTC), across all users.
 * Cloudflare Images on the free plan gives 5,000 unique transformations a month and refuses the rest (error 9422)
 * without billing; every cutout takes two (the cutout, then its thumbnail), so 2,500 fit. 2,400 leaves room for
 * retries, and it is the money rule's cap in code: should the account ever move to a paid Images plan, extra
 * transformations would bill, and this stops them first.
 */
export const MONTHLY_CLOUDFLARE_CUTOUTS = 2_400;

/**
 * Whether one more Cloudflare cutout may start, given this month's count. An unknown count (null) never allows one:
 * the money rule counts unknown as spent. Pure, so the rule is tested without a database.
 */
export function cloudflareAllows(usedThisMonth: number | null, cap = MONTHLY_CLOUDFLARE_CUTOUTS): boolean {
  return usedThisMonth !== null && usedThisMonth < cap;
}

/** The 1st of the current month, UTC: where the monthly count starts. */
export function monthStart(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

type Fetch = typeof fetch;
type Env = (name: string) => string | undefined;

// don't touch / 25 s per call, and no retry after a timeout: a segment answers in 2-4 s, and whatever time
// Cloudflare spends failing is taken from the Modal fallback, which needs up to 140 s of the Edge Function's 150 s
// wall clock for a cold start.
const CALL_TIMEOUT_MS = 25_000;

/**
 * cutoutCloudflare: background removal for one garment crop on the `fit-check-cutout` Worker (worker/cloudflare),
 * which runs Cloudflare Images `segment: "foreground"`. Never throws.
 *
 * Two requests: the crop in, the trimmed transparent PNG out; then that PNG in, its 400 px thumbnail out. Neither
 * isolates the front garment the way the Modal worker's SAM pass did, so clothes hanging behind it can stay in the
 * cutout (`isolated: false`); the redraw on request is the way to a single garment.
 *
 * Inputs: the crop's bytes and media type. Needs CLOUDFLARE_CUTOUT_URL and CLOUDFLARE_CUTOUT_TOKEN in the function
 * env; without them it answers `notConfigured`. Failure modes: network error or timeout, 401 (token mismatch),
 * 429 (the month's free transformations are used up), 502 (Images failed). One retry, only for a fast failure on the
 * cutout itself (a 5xx or a dropped connection, not a timeout): testing saw a transient Images error pass on the
 * second try.
 */
export async function cutoutCloudflare(
  image: Uint8Array,
  mediaType: string,
  fetchImpl: Fetch = fetch,
  env: Env = (name) => Deno.env.get(name),
): Promise<CutoutResult> {
  const started = Date.now();
  const base = { provider: "cloudflare" as const, model: CLOUDFLARE_CUTOUT_MODEL, task: "cutout" as const, images: 1 };
  const fail = (error: string, notConfigured = false): CutoutResult => ({
    ok: false,
    notConfigured,
    log: { ...base, latency_ms: Date.now() - started, ok: false, error: error.slice(0, 300) },
  });
  const url = env("CLOUDFLARE_CUTOUT_URL")?.trim().replace(/\/+$/, "");
  const token = env("CLOUDFLARE_CUTOUT_TOKEN")?.trim();
  if (!url || !token) return fail("CLOUDFLARE_CUTOUT_URL / CLOUDFLARE_CUTOUT_TOKEN not set", true);

  const call = async (target: string, body: Uint8Array, type: string): Promise<Response | string> => {
    try {
      return await fetchImpl(target, {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": type },
        // A Blob, not the raw Uint8Array: fetch types only accept ArrayBuffer-backed bodies.
        body: new Blob([body.slice()], { type }),
        signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
      });
    } catch (error) {
      return error instanceof DOMException && error.name === "TimeoutError" ? `timeout after ${CALL_TIMEOUT_MS} ms` : `network: ${String(error)}`;
    }
  };
  const describe = async (res: Response | string) =>
    typeof res === "string" ? res : `HTTP ${res.status}: ${(await res.text().catch(() => "")).slice(0, 200)}`;

  let res = await call(`${url}/`, image, mediaType);
  if ((typeof res === "string" && !res.startsWith("timeout")) || (typeof res !== "string" && res.status >= 500)) {
    if (typeof res !== "string") await res.body?.cancel();
    res = await call(`${url}/`, image, mediaType);
  }
  if (typeof res === "string" || !res.ok) return fail(await describe(res));
  const cutout = new Uint8Array(await res.arrayBuffer());
  if (cutout.length === 0) return fail("empty cutout");

  const thumbRes = await call(`${url}/?op=thumb`, cutout, "image/png");
  if (typeof thumbRes === "string" || !thumbRes.ok) return fail(`thumb ${await describe(thumbRes)}`);
  const thumb = new Uint8Array(await thumbRes.arrayBuffer());
  if (thumb.length === 0) return fail("empty thumb");

  const log: AiLogEntry = { ...base, latency_ms: Date.now() - started, ok: true, cost_usd: 0 };
  return { ok: true, cutout, thumb, isolated: false, log };
}
