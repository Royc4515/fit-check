import { cloudflareAllows, CLOUDFLARE_CUTOUT_MODEL, cutoutCloudflare, monthStart } from "./cloudflare.ts";
import { countModelCalls } from "./log.ts";
import { cutout as cutoutModal, type CutoutResult } from "./modal.ts";
import type { AiLogEntry } from "./types.ts";

/** What a background removal came to, in the words intake-cutout answers the app with. */
export type BackgroundOutcome =
  | { ok: true; cutout: Uint8Array; thumb: Uint8Array; /** Whether other garments were removed (Modal's SAM pass). */ isolated: boolean | null }
  | { ok: false; reason: "not_configured" | "cutout_monthly_limit" | "ai_failed"; error: string };

/** The providers and the monthly count, injectable so the order and the fallbacks are tested without a network. */
export type BackgroundDeps = {
  cloudflare: (image: Uint8Array, mediaType: string) => Promise<CutoutResult>;
  modal: (image: Uint8Array, mediaType: string, isolate: boolean) => Promise<CutoutResult>;
  /** Cloudflare cutouts this month, all users; null when it cannot be read. */
  cloudflareUsedThisMonth: () => Promise<number | null>;
};

const liveDeps: BackgroundDeps = {
  cloudflare: (image, mediaType) => cutoutCloudflare(image, mediaType),
  modal: cutoutModal,
  cloudflareUsedThisMonth: () => countModelCalls(CLOUDFLARE_CUTOUT_MODEL, monthStart(new Date())),
};

/**
 * removeBackground: the one way the Edge Functions cut a garment out of its crop (intake-cutout and the mcp tools).
 *
 * Cloudflare Images first: free (2,400 a month, see cloudflare.ts), a few seconds, but it keeps clothes hanging
 * behind the garment. The Modal worker (BiRefNet plus SAM, which drops those) only when Cloudflare is not set up,
 * is past its monthly cap, or failed: Modal runs on a $1 monthly credit that covers a few dozen cutouts.
 * Neither path can bill: past either quota the provider refuses, and the money rule's cap stops Cloudflare first.
 *
 * Inputs: the crop's bytes and media type; `isolate` (Modal only): false for AI redraws, which show one garment;
 * `log`: receives one ai_calls entry for every provider that was actually called.
 * Failure modes, as `reason`: "not_configured" when no provider is set up (the app keeps the plain crop),
 * "cutout_monthly_limit" when Cloudflare's cap is reached and Modal cannot stand in, "ai_failed" otherwise.
 * Never throws.
 */
export async function removeBackground(
  image: Uint8Array,
  mediaType: string,
  isolate: boolean,
  log: (entry: AiLogEntry) => Promise<void>,
  deps: BackgroundDeps = liveDeps,
): Promise<BackgroundOutcome> {
  let cloudflare: "capped" | "unset" | "failed" = "capped";
  let error = "";
  if (cloudflareAllows(await deps.cloudflareUsedThisMonth())) {
    const cf = await deps.cloudflare(image, mediaType);
    if (cf.ok) {
      await log(cf.log);
      return { ok: true, cutout: cf.cutout, thumb: cf.thumb, isolated: cf.isolated };
    }
    // Not configured is not a call; logging it would count against the caps for nothing.
    if (cf.notConfigured) cloudflare = "unset";
    else {
      await log(cf.log);
      cloudflare = "failed";
      error = `cloudflare: ${cf.log.error ?? "failed"}`;
    }
  }

  const modal = await deps.modal(image, mediaType, isolate);
  if (modal.ok || !modal.notConfigured) await log(modal.log);
  if (modal.ok) return { ok: true, cutout: modal.cutout, thumb: modal.thumb, isolated: modal.isolated };
  const modalError = modal.notConfigured ? "" : `modal: ${modal.log.error ?? "failed"}`;
  error = [error, modalError].filter(Boolean).join("; ");
  if (cloudflare === "capped") return { ok: false, reason: "cutout_monthly_limit", error: error || "monthly cap reached" };
  if (cloudflare === "unset" && modal.notConfigured) return { ok: false, reason: "not_configured", error: "no provider set up" };
  return { ok: false, reason: "ai_failed", error };
}
