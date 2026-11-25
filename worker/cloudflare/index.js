// @ts-check
/**
 * fit-check-cutout: background removal on Cloudflare Images (`segment: "foreground"`, BiRefNet run by Cloudflare).
 * Called only by the `intake-cutout` Edge Function, with a bearer token (secret WORKER_TOKEN).
 *
 * POST /         body: a garment crop (jpeg, png or webp). Answers the cutout: transparent PNG, trimmed to the garment,
 *                at most 2048 px on its long edge (what the Modal worker gave).
 * POST /?op=thumb body: a cutout. Answers it scaled to fit 400 x 400, for the wardrobe grid. A plain resize, no model.
 *
 * Errors: 401 without the token, 405 for anything but POST, 400 for an empty or non-image body, 429 when the
 * month's free transformations are used up (Images error 9422: on the free plan Cloudflare refuses, it never bills),
 * 502 for any other Images failure, with the message in the body.
 *
 * Two calls rather than one answer holding both images: the Worker then only streams what Images produces, which
 * keeps it far inside the free plan's 10 ms of CPU per request; base64 of a 2 MB PNG would not be.
 */

/** @typedef {{ IMAGES: ImagesBinding, WORKER_TOKEN: string }} Env */
/**
 * The part of the Images binding this Worker uses.
 * @typedef {{ input(stream: ReadableStream): ImageChain }} ImagesBinding
 * @typedef {{ transform(options: Record<string, unknown>): ImageChain, output(options: { format: string }): Promise<{ response(): Response }> }} ImageChain
 */

const MAX_EDGE = 2048;
const THUMB_EDGE = 400;
const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

/**
 * Token check without an early exit on the first differing byte, so response time says nothing about the token.
 * @param {string} given
 * @param {string} expected
 */
function sameToken(given, expected) {
  const a = new TextEncoder().encode(given);
  const b = new TextEncoder().encode(expected);
  let diff = a.length ^ b.length;
  for (let i = 0; i < b.length; i++) diff |= (a[i] ?? 0) ^ b[i];
  return expected.length > 0 && diff === 0;
}

/** @param {number} status @param {string} message */
const fail = (status, message) => new Response(message, { status, headers: { "content-type": "text/plain" } });

export default {
  /**
   * @param {Request} request
   * @param {Env} env
   */
  async fetch(request, env) {
    if (request.method !== "POST") return fail(405, "method");
    const auth = request.headers.get("authorization") ?? "";
    if (!env.WORKER_TOKEN || !sameToken(auth.replace(/^Bearer\s+/i, ""), env.WORKER_TOKEN)) return fail(401, "unauthorized");
    const type = (request.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
    if (!IMAGE_TYPES.has(type) || !request.body) return fail(400, "bad_input");

    const thumb = new URL(request.url).searchParams.get("op") === "thumb";
    try {
      const chain = thumb
        ? env.IMAGES.input(request.body).transform({ width: THUMB_EDGE, height: THUMB_EDGE, fit: "scale-down" })
        : env.IMAGES.input(request.body)
            .transform({ segment: "foreground" })
            // don't touch / trim after segment, not before: the transparent margin only exists once the background is
            // gone, and the app lays cutouts out by their edges (the Modal worker cropped to the alpha bounding box).
            .transform({ trim: "border" })
            .transform({ width: MAX_EDGE, height: MAX_EDGE, fit: "scale-down" });
      const res = (await chain.output({ format: "image/png" })).response();
      // Images can answer a failure as a response rather than a throw (a transient "Error code: 1104" in testing).
      if (!res.ok) return fail(502, `images ${res.status}: ${(await res.text()).slice(0, 200)}`);
      return res;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return fail(/\b9422\b/.test(message) ? 429 : 502, message.slice(0, 300));
    }
  },
};
