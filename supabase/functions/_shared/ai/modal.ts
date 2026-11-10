import { z } from "zod";
import type { AiLogEntry } from "./types.ts";

/**
 * USD per second of the cutout container: 8 CPU cores at Modal's ~$0.0000131 per core-second (2026-11), billed
 * against the $30/month Starter credit. An estimate for cost visibility; memory is not included.
 */
const WORKER_PER_SECOND = 8 * 0.0000131;

const CutoutResponseSchema = z.object({
  cutout_png_b64: z.string().min(1),
  thumb_png_b64: z.string().min(1),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  gpu_seconds: z.number().nonnegative(),
});

export type CutoutResult =
  | { ok: true; cutout: Uint8Array; thumb: Uint8Array; log: AiLogEntry }
  | { ok: false; notConfigured: boolean; log: AiLogEntry };

function fromBase64(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/**
 * cutout: background removal for one garment photo on the Modal worker (BiRefNet, worker/app.py). Never throws.
 *
 * Inputs: the crop's bytes and media type. Needs MODAL_CUTOUT_URL and MODAL_WORKER_TOKEN in the function env;
 * without them it answers `notConfigured` so the app keeps the plain crop. Failure modes: network error or timeout
 * (a cold start downloads the model once, so the first call can take a minute), non-200 from the worker, or an
 * answer that fails the schema. The cost logged is wall time x 8 CPU cores, an upper bound on the billed time.
 */
export async function cutout(image: Uint8Array, mediaType: string): Promise<CutoutResult> {
  const started = Date.now();
  const base = { provider: "modal" as const, model: "birefnet-general", task: "cutout" as const, images: 1 };
  const url = Deno.env.get("MODAL_CUTOUT_URL");
  const token = Deno.env.get("MODAL_WORKER_TOKEN");
  const fail = (error: string, notConfigured = false): CutoutResult => ({
    ok: false,
    notConfigured,
    log: { ...base, latency_ms: Date.now() - started, ok: false, error: error.slice(0, 300) },
  });
  if (!url || !token) return fail("MODAL_CUTOUT_URL / MODAL_WORKER_TOKEN not set", true);

  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": mediaType },
      // A Blob, not the raw Uint8Array: fetch types only accept ArrayBuffer-backed bodies.
      body: new Blob([image.slice()], { type: mediaType }),
      // don't touch / 140 s: on CPU a warm call takes 10-20 s, and a cold container first loads BiRefNet (on the very
      // first run, downloads it). A shorter timeout fails exactly the first photo of every session. The Edge
      // Function wall-clock limit is 150 s, so this cannot go higher.
      signal: AbortSignal.timeout(140_000),
    });
  } catch (error) {
    return fail(`network: ${String(error)}`);
  }
  if (!res.ok) return fail(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const parsed = CutoutResponseSchema.safeParse(await res.json().catch(() => null));
  if (!parsed.success) return fail("bad worker response");

  const latency = Date.now() - started;
  return {
    ok: true,
    cutout: fromBase64(parsed.data.cutout_png_b64),
    thumb: fromBase64(parsed.data.thumb_png_b64),
    log: { ...base, latency_ms: latency, ok: true, cost_usd: Math.round((latency / 1000) * WORKER_PER_SECOND * 100_000) / 100_000 },
  };
}
