import type { AiLogEntry } from "../_shared/ai/types.ts";
import { FIGURE_PRICE_USD, TRYON_MODEL, TRYON_PRICE_USD, type TryonGarment, type TryonImage, type TryonResult } from "../_shared/ai/tryon.ts";
import { MONTHLY_GOOGLE_BUDGET_USD } from "../_shared/ai/budget.ts";
import { FIGURE_PATH, handleTryon, tryonImagePath, type TryonDeps } from "./handler.ts";
import type { TryonItemRow, TryonStore } from "./store.ts";

const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const TOP = "11111111-1111-4111-8111-111111111111";
const BOTTOM = "22222222-2222-4222-8222-222222222222";
const SHOES = "33333333-3333-4333-8333-333333333333";
const LAYER = "44444444-4444-4444-8444-444444444444";
const BARE = "55555555-5555-4555-8555-555555555555";
const OTHERS = "66666666-6666-4666-8666-666666666666";

const row = (id: string, category: string, cutout_path: string | null = `${A}/${id}.png`): TryonItemRow => ({
  id,
  category,
  subcategory: category === "top" ? "button_down" : category === "bottom" ? "chinos" : category === "shoes" ? "boots" : "knit",
  color_name: "navy",
  color_hex: "#1F2A44",
  pattern: "solid",
  material: "cotton",
  formality: 5,
  cutout_path,
});
/** User A's wardrobe; OTHERS belongs to someone else and is never returned for A. */
const OWNED: Record<string, TryonItemRow[]> = {
  [A]: [row(TOP, "top"), row(BOTTOM, "bottom"), row(SHOES, "shoes"), row(LAYER, "layer"), row(BARE, "top", null)],
  other: [row(OTHERS, "top")],
};
const outfit = [
  { item_id: TOP, slot: "top" },
  { item_id: BOTTOM, slot: "bottom" },
  { item_id: SHOES, slot: "shoes" },
];
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const success = (cost: number): TryonResult => ({
  ok: true,
  image: PNG,
  mimeType: "image/png",
  log: { provider: "google", model: TRYON_MODEL, task: "tryon", images: 1, cost_usd: cost, latency_ms: 10, ok: true },
});

interface Harness {
  deps: TryonDeps;
  files: Map<string, Uint8Array>;
  uploads: Array<{ path: string; upsert: boolean }>;
  logs: AiLogEntry[];
  calls: { outfit: number; figure: number; outfitGarments: TryonGarment[][]; outfitFigures: TryonImage[] };
  setSpend(v: number | null): void;
  /** Runs while the figure is being drawn: a stand-in for another press finishing meanwhile. */
  setOnFigure(fn: () => void): void;
}

function harness(opts: { spend?: number | null; outfit?: () => TryonResult; withFigure?: boolean } = {}): Harness {
  const files = new Map<string, Uint8Array>();
  if (opts.withFigure) files.set(FIGURE_PATH, PNG);
  const uploads: Harness["uploads"] = [];
  const logs: AiLogEntry[] = [];
  const calls: Harness["calls"] = { outfit: 0, figure: 0, outfitGarments: [], outfitFigures: [] };
  let spend: number | null = opts.spend === undefined ? 1 : opts.spend;
  let onFigure: (() => void) | undefined;
  const store: TryonStore = {
    readItems: (userId, ids) => Promise.resolve((OWNED[userId] ?? []).filter((r) => ids.includes(r.id))),
    readGarmentImage: (path) => Promise.resolve(path.startsWith(`${A}/`) ? PNG : null),
    exists: (path) => Promise.resolve(files.has(path)),
    download: (path) => Promise.resolve(files.get(path) ?? null),
    upload: (path, bytes, _type, upsert) => {
      uploads.push({ path, upsert });
      if (!upsert && files.has(path)) return Promise.resolve("exists");
      files.set(path, bytes);
      return Promise.resolve("ok");
    },
    signedUrl: (path, ttl) => Promise.resolve(`https://project.supabase.co/storage/v1/object/sign/originals/${path}?token=t&ttl=${ttl}`),
  };
  const deps: TryonDeps = {
    authenticate: (req) => {
      const token = (req.headers.get("authorization") ?? "").replace("Bearer ", "");
      return Promise.resolve(token === "good" ? { ok: true, userId: A } : { ok: false, detail: "no user token" });
    },
    store: () => store,
    monthlySpend: () => Promise.resolve(spend),
    logAiCall: (_userId, entry) => {
      logs.push(entry);
      if (spend !== null) spend += entry.cost_usd ?? 0;
      return Promise.resolve();
    },
    renderOutfit: (garments, figure) => {
      calls.outfit++;
      calls.outfitGarments.push([...garments]);
      calls.outfitFigures.push(figure);
      return Promise.resolve(opts.outfit ? opts.outfit() : success(0.043));
    },
    renderFigure: () => {
      calls.figure++;
      onFigure?.();
      return Promise.resolve(success(0.036));
    },
  };
  return { deps, files, uploads, logs, calls, setSpend: (v) => (spend = v), setOnFigure: (fn) => (onFigure = fn) };
}

const post = (body: unknown, token = "good") =>
  new Request("https://fn/tryon", { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: typeof body === "string" ? body : JSON.stringify(body) });

async function call(h: Harness, body: unknown, token?: string): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await handleTryon(post(body, token), h.deps);
  return { status: res.status, body: await res.json() };
}

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

Deno.test("unauthenticated: 401 and nothing read or spent", async () => {
  const h = harness();
  const r = await call(h, { mode: "render", items: outfit }, "bad");
  assert(r.status === 401 && r.body.error === "unauthenticated", JSON.stringify(r));
  assert(h.calls.outfit === 0 && h.calls.figure === 0, "no provider call");
});

Deno.test("invalid input: bad JSON, a broken outfit rule, a garment in the wrong slot", async () => {
  const h = harness();
  for (const body of ["{not json", { mode: "render", items: outfit.slice(0, 2) }, { mode: "paint", items: outfit }]) {
    const r = await call(h, body);
    assert(r.status === 400 && r.body.error === "invalid_input", JSON.stringify(r));
  }
  const wrongSlot = await call(h, { mode: "render", items: [{ item_id: TOP, slot: "top" }, { item_id: BOTTOM, slot: "bottom" }, { item_id: LAYER, slot: "shoes" }] });
  assert(wrongSlot.status === 400 && wrongSlot.body.item_id === LAYER, JSON.stringify(wrongSlot));
  const options = await handleTryon(new Request("https://fn/tryon", { method: "OPTIONS" }), h.deps);
  assert(options.status === 200 && options.headers.get("access-control-allow-origin") === "*", "CORS preflight");
});

Deno.test("another user's item is item_not_found", async () => {
  const h = harness();
  const r = await call(h, { mode: "render", items: [{ item_id: OTHERS, slot: "top" }, outfit[1], outfit[2]] });
  assert(r.status === 404 && r.body.error === "item_not_found" && r.body.item_id === OTHERS, JSON.stringify(r));
  assert(h.calls.outfit === 0, "no provider call");
});

Deno.test("an item without an image is item_has_no_image, before anything is paid", async () => {
  const h = harness();
  const r = await call(h, { mode: "render", items: [{ item_id: BARE, slot: "top" }, outfit[1], outfit[2]] });
  assert(r.status === 422 && r.body.error === "item_has_no_image" && r.body.item_id === BARE, JSON.stringify(r));
  assert(h.calls.figure === 0 && h.calls.outfit === 0, "nothing generated");
});

Deno.test("quote never calls the provider, and includes the figure while it is missing", async () => {
  const h = harness({ spend: 2.5 });
  const first = await call(h, { mode: "quote", items: outfit });
  assert(first.status === 200 && first.body.ok === true && first.body.cached === false, JSON.stringify(first));
  assert(first.body.includes_figure === true && Math.abs(Number(first.body.price_usd) - (TRYON_PRICE_USD + FIGURE_PRICE_USD)) < 1e-9, JSON.stringify(first));
  assert(first.body.month_spend_usd === 2.5 && first.body.budget_usd === MONTHLY_GOOGLE_BUDGET_USD, JSON.stringify(first));
  h.files.set(FIGURE_PATH, PNG);
  h.files.set(await tryonImagePath(A, [SHOES, TOP, BOTTOM]), PNG);
  const later = await call(h, { mode: "quote", items: outfit });
  assert(later.body.includes_figure === false && later.body.price_usd === TRYON_PRICE_USD && later.body.cached === true, JSON.stringify(later));
  h.setSpend(null);
  const unknown = await call(h, { mode: "quote", items: outfit });
  assert(unknown.body.ok === true && unknown.body.month_spend_usd === null, "a quote still answers when spend is unknown");
  assert(h.calls.outfit === 0 && h.calls.figure === 0 && h.logs.length === 0 && h.uploads.length === 0, "no cost, no row, no write");
});

Deno.test("render with a stored image never calls the provider", async () => {
  const h = harness({ withFigure: true });
  // Same garments in another order: the same stored image.
  h.files.set(await tryonImagePath(A, [BOTTOM, SHOES, TOP]), PNG);
  const r = await call(h, { mode: "render", items: outfit });
  assert(r.body.ok === true && r.body.cached === true && r.body.cost_usd === 0, JSON.stringify(r));
  assert(String(r.body.image_url).includes("/object/sign/") && r.body.expires_in_s === 600, JSON.stringify(r));
  assert(h.calls.outfit === 0 && h.logs.length === 0, "free");
});

Deno.test("render generates, stores, logs and returns a signed URL", async () => {
  const h = harness({ withFigure: true, spend: 1 });
  const r = await call(h, { mode: "render", items: [...outfit, { item_id: LAYER, slot: "layer" }] });
  const path = await tryonImagePath(A, [TOP, BOTTOM, SHOES, LAYER]);
  assert(r.body.ok === true && r.body.cached === false && r.body.cost_usd === 0.043 && r.body.month_spend_usd === 1.043, JSON.stringify(r));
  assert(String(r.body.image_url).includes(path), "the URL signs the stored image");
  assert(h.files.has(path) && h.uploads.some((u) => u.path === path), "stored");
  assert(path.startsWith(`tryon/${A}/`) && path.endsWith(".png"), path);
  assert(h.logs.length === 1 && h.logs[0]!.task === "tryon" && h.logs[0]!.images === 1, JSON.stringify(h.logs));
  assert(h.calls.outfitGarments[0]!.length === 4 && h.calls.outfitFigures[0]!.image === PNG, "figure and four garments sent");
});

Deno.test("rerender generates even when stored, and replaces the image", async () => {
  const h = harness({ withFigure: true });
  const path = await tryonImagePath(A, [TOP, BOTTOM, SHOES]);
  h.files.set(path, new Uint8Array([1]));
  const r = await call(h, { mode: "rerender", items: outfit });
  assert(r.body.ok === true && r.body.cached === false && h.calls.outfit === 1, JSON.stringify(r));
  assert(h.files.get(path) === PNG && h.uploads.find((u) => u.path === path)?.upsert === true, "replaced");
});

Deno.test("budget reached before the call: nothing generated, nothing logged", async () => {
  const h = harness({ withFigure: true, spend: MONTHLY_GOOGLE_BUDGET_USD - 0.01 });
  const r = await call(h, { mode: "render", items: outfit });
  assert(r.status === 200 && r.body.error === "budget_reached" && r.body.budget_usd === MONTHLY_GOOGLE_BUDGET_USD, JSON.stringify(r));
  assert(h.calls.outfit === 0 && h.logs.length === 0, "no call");
});

Deno.test("spend that cannot be read counts as spent", async () => {
  const h = harness({ withFigure: true, spend: null });
  const r = await call(h, { mode: "rerender", items: outfit });
  assert(r.body.error === "budget_reached" && r.body.month_spend_usd === null, JSON.stringify(r));
  assert(h.calls.outfit === 0, "no call");
});

Deno.test("the figure is not made when the outfit image could not follow it within the cap", async () => {
  const h = harness({ spend: MONTHLY_GOOGLE_BUDGET_USD - TRYON_PRICE_USD - 0.01 });
  const r = await call(h, { mode: "render", items: outfit });
  assert(r.body.error === "budget_reached" && h.calls.figure === 0, JSON.stringify(r));
});

Deno.test("the figure is created once, logged, stored without overwrite, and reused", async () => {
  const h = harness();
  const first = await call(h, { mode: "render", items: outfit });
  assert(first.body.ok === true && h.calls.figure === 1 && h.files.has(FIGURE_PATH), JSON.stringify(first));
  assert(first.body.cost_usd === 0.079, `figure + outfit: ${first.body.cost_usd}`);
  assert(h.uploads.find((u) => u.path === FIGURE_PATH)?.upsert === false, "the figure is never overwritten");
  assert(h.logs.length === 2, "two rows: the figure and the outfit");
  const second = await call(h, { mode: "render", items: [...outfit, { item_id: LAYER, slot: "layer" }] });
  assert(second.body.ok === true && h.calls.figure === 1 && h.calls.outfit === 2, "figure reused");
});

Deno.test("double press: an image stored while this press drew the figure is returned, not paid again", async () => {
  const h = harness();
  const path = await tryonImagePath(A, [TOP, BOTTOM, SHOES]);
  h.setOnFigure(() => h.files.set(path, PNG));
  const r = await call(h, { mode: "render", items: outfit });
  assert(r.body.ok === true && r.body.cached === true && h.calls.outfit === 0, JSON.stringify(r));
});

Deno.test("a provider refusal is typed and still logged", async () => {
  const refused: TryonResult = {
    ok: false,
    error: "provider_refused",
    providerCalled: true,
    log: { provider: "google", model: TRYON_MODEL, task: "tryon", images: 1, cost_usd: 0.009, latency_ms: 5, ok: false, error: "no image (IMAGE_SAFETY)" },
  };
  const h = harness({ withFigure: true, outfit: () => refused });
  const r = await call(h, { mode: "render", items: outfit });
  assert(r.status === 200 && r.body.error === "provider_refused", JSON.stringify(r));
  assert(h.logs.length === 1 && h.logs[0]!.ok === false, "logged");
  assert(!h.files.has(await tryonImagePath(A, [TOP, BOTTOM, SHOES])), "nothing stored");
});
