import {
  buildTryonPrompt,
  FIGURE_PRICE_USD,
  renderFigure,
  renderOutfit,
  TRYON_MODEL,
  TRYON_PRICE_USD,
  tuckedIn,
  type TryonGarment,
} from "./tryon.ts";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
const garment = (slot: TryonGarment["slot"], extra: Partial<TryonGarment> = {}): TryonGarment => ({
  slot,
  subcategory: slot === "top" ? "tshirt" : slot === "bottom" ? "chinos" : slot === "shoes" ? "sneakers" : "knit",
  color_name: "navy",
  color_hex: "#1F2A44",
  pattern: "solid",
  material: "cotton",
  formality: 4,
  image: new Uint8Array([slot.length]),
  mimeType: "image/png",
  ...extra,
});
const outfit = [garment("shoes"), garment("bottom"), garment("layer"), garment("top")];
const figure = { image: new Uint8Array([9, 9]), mimeType: "image/png" };

type Captured = { url: string; body: Record<string, unknown> };

/** Replaces fetch for one test; restores it afterwards. No network is ever touched. */
async function withFetch(handler: (url: string, init: RequestInit) => Promise<Response>, run: (calls: Captured[]) => Promise<void>) {
  const original = globalThis.fetch;
  const calls: Captured[] = [];
  globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, body: JSON.parse(String(init?.body ?? "{}")) });
    return handler(url, init ?? {});
  }) as typeof fetch;
  Deno.env.set("GEMINI_IMAGE_API_KEY", "test-key");
  try {
    await run(calls);
  } finally {
    globalThis.fetch = original;
  }
}

const imageAnswer = (extra: Record<string, unknown> = {}) =>
  Response.json({
    candidates: [{ content: { parts: [{ inlineData: { mimeType: "image/png", data: btoa("IMG") } }] }, finishReason: "STOP" }],
    usageMetadata: { promptTokenCount: 6000, candidatesTokenCount: 1120, candidatesTokensDetails: [{ modality: "IMAGE", tokenCount: 1120 }] },
    ...extra,
  });

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

Deno.test("the provider receives the model, the figure first, the garments in slot order, 4:5 at 1K", async () => {
  await withFetch(() => Promise.resolve(imageAnswer()), async (calls) => {
    const result = await renderOutfit(outfit, figure);
    assert(result.ok, "expected an image");
    assert(calls.length === 1, `one request, got ${calls.length}`);
    const call = calls[0]!;
    assert(call.url.endsWith(`/models/${TRYON_MODEL}:generateContent`), call.url);
    const contents = call.body.contents as Array<{ parts: Array<Record<string, { data?: string } | string>> }>;
    const parts = contents[0]!.parts;
    const images = parts.filter((p) => "inline_data" in p).map((p) => (p.inline_data as { data: string }).data);
    // figure, top, layer, bottom, shoes: the image bytes encode the slot name's length (3, 5, 6, 5).
    const expected = [figure.image, garment("top").image, garment("layer").image, garment("bottom").image, garment("shoes").image].map((b) => btoa(String.fromCharCode(...b)));
    assert(JSON.stringify(images) === JSON.stringify(expected), `image order ${JSON.stringify(images)}`);
    assert("text" in parts[0]! && String(parts[0]!.text).startsWith("Image 1 is a drawn figure"), "prompt first");
    const config = call.body.generationConfig as { responseModalities: string[]; imageConfig: { aspectRatio: string; imageSize: string } };
    assert(config.imageConfig.aspectRatio === "4:5" && config.imageConfig.imageSize === "1K", JSON.stringify(config));
    assert(JSON.stringify(config.responseModalities) === '["IMAGE"]', "image only");
  });
});

Deno.test("a good answer returns the bytes and a log priced from the usage", async () => {
  await withFetch(() => Promise.resolve(imageAnswer()), async () => {
    const result = await renderOutfit(outfit, figure);
    assert(result.ok, "expected an image");
    assert(new TextDecoder().decode(result.image) === "IMG", "decoded bytes");
    // 6000 * 1.5e-6 + 1120 * 30e-6 = 0.009 + 0.0336
    assert(result.log.cost_usd === 0.0426, `cost ${result.log.cost_usd}`);
    assert(result.log.task === "tryon" && result.log.model === TRYON_MODEL && result.log.images === 1 && result.log.ok, JSON.stringify(result.log));
    assert((result.log.cost_usd ?? 1) <= TRYON_PRICE_USD, "the shown price covers a typical call");
  });
});

Deno.test("a safety finish reason and a prompt block are refusals, logged with their input cost", async () => {
  const refusal = Response.json({ candidates: [{ content: { parts: [] }, finishReason: "IMAGE_SAFETY" }], usageMetadata: { promptTokenCount: 6000 } });
  await withFetch(() => Promise.resolve(refusal), async () => {
    const result = await renderOutfit(outfit, figure);
    assert(!result.ok && result.error === "provider_refused" && result.providerCalled, JSON.stringify(result));
    assert(result.log.cost_usd === 0.009 && result.log.error?.includes("IMAGE_SAFETY"), JSON.stringify(result.log));
  });
  await withFetch(() => Promise.resolve(Response.json({ promptFeedback: { blockReason: "PROHIBITED_CONTENT" } })), async () => {
    const result = await renderOutfit(outfit, figure);
    assert(!result.ok && result.error === "provider_refused", JSON.stringify(result));
  });
  await withFetch(() => Promise.resolve(Response.json({ candidates: [{ content: { parts: [{ text: "Here you go" }] }, finishReason: "NO_IMAGE" }] })), async () => {
    const result = await renderOutfit(outfit, figure);
    assert(!result.ok && result.error === "provider_error", "no image without a safety reason is an error, not a refusal");
  });
});

Deno.test("a timeout answers provider_timeout, once, and is logged at the estimated price", async () => {
  const hang = (_url: string, init: RequestInit) =>
    new Promise<Response>((_, reject) => init.signal?.addEventListener("abort", () => reject(init.signal?.reason)));
  await withFetch(hang, async (calls) => {
    const result = await renderOutfit(outfit, figure, 20);
    assert(!result.ok && result.error === "provider_timeout" && result.providerCalled, JSON.stringify(result));
    assert((result.log.cost_usd ?? 0) > 0.05, `a timeout counts as spent: ${result.log.cost_usd}`);
    assert(calls.length === 1, "no automatic retry");
  });
});

Deno.test("a 429 (and a 503) answers provider_error at once, with no retry and no cost", async () => {
  for (const status of [429, 503]) {
    await withFetch(() => Promise.resolve(new Response("quota", { status })), async (calls) => {
      const result = await renderOutfit(outfit, figure);
      assert(!result.ok && result.error === "provider_error" && result.log.error?.startsWith(`HTTP ${status}`), JSON.stringify(result));
      assert(result.log.cost_usd === 0 && calls.length === 1, "one call, nothing billed");
    });
  }
});

Deno.test("without a key nothing is sent and providerCalled is false", async () => {
  const original = globalThis.fetch;
  let called = false;
  globalThis.fetch = (() => {
    called = true;
    return Promise.resolve(new Response());
  }) as typeof fetch;
  Deno.env.delete("GEMINI_IMAGE_API_KEY");
  try {
    const result = await renderFigure();
    assert(!result.ok && !result.providerCalled && !called, JSON.stringify(result));
  } finally {
    globalThis.fetch = original;
  }
});

Deno.test("the figure is drawn from text alone", async () => {
  await withFetch(() => Promise.resolve(imageAnswer()), async (calls) => {
    const result = await renderFigure();
    assert(result.ok, "figure");
    const parts = (calls[0]!.body.contents as Array<{ parts: Array<Record<string, unknown>> }>)[0]!.parts;
    assert(parts.length === 1 && "text" in parts[0]!, "no image is sent for the figure");
    assert(FIGURE_PRICE_USD < TRYON_PRICE_USD, "the figure has no input images");
  });
});

Deno.test("prompt: tucked only for a formal button-down; keeps logos; adds nothing; names images in slot order", () => {
  const casual = buildTryonPrompt(outfit);
  assert(casual.includes("worn untucked") && !tuckedIn(outfit), "casual top is out");
  const formal = [garment("top", { subcategory: "button_down", formality: 7 }), garment("bottom"), garment("shoes")];
  assert(tuckedIn(formal) && buildTryonPrompt(formal).includes("tucked into the trousers"), "formal button-down is in");
  assert(!tuckedIn([garment("top", { subcategory: "button_down", formality: 6 })]), "6 is not formal enough");
  assert(!tuckedIn([garment("top", { subcategory: "polo", formality: 9 })]), "only button-downs tuck");
  assert(casual.includes("logo") && casual.includes("no text") && casual.includes("#EDE7DB"), casual);
  assert(casual.indexOf("Image 2: the top") < casual.indexOf("Image 3: the layer") && casual.indexOf("Image 4: the trousers") < casual.indexOf("Image 5: the shoes"), casual);
});
