import {
  type TryonErrorCode,
  type TryonErrorResponse,
  type TryonQuoteResponse,
  type TryonRenderResponse,
  TryonRequestSchema,
  tryonCacheKeyInput,
} from "@fit-check/schema/tryon.ts";
import type { AuthResult } from "../_shared/auth.ts";
import { googleBudgetAllows, MONTHLY_GOOGLE_BUDGET_USD } from "../_shared/ai/budget.ts";
import {
  FIGURE_PRICE_USD,
  FIGURE_VERSION,
  type renderFigure,
  type renderOutfit,
  TRYON_MODEL,
  TRYON_PRICE_USD,
  type TryonGarment,
  type TryonResult,
} from "../_shared/ai/tryon.ts";
import type { AiLogEntry } from "../_shared/ai/types.ts";
import { sniffImageType } from "../_shared/media.ts";
import { fillsSlot, type TryonStore } from "./store.ts";

/** Shared by every user: one fixed figure (DESIGN.md "שלב 5.3" item 3). Versioned, so a new figure misses every cache. */
export const FIGURE_PATH = `tryon/figure/${FIGURE_VERSION}.png`;
/** 24 hours: keeps the signed URL stable across revisits so browser/app image caches hit instead of re-downloading. */
export const SIGNED_URL_TTL_S = 86400;

export const cors = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, x-client-info, apikey, content-type",
  "access-control-allow-methods": "POST, OPTIONS",
};

/** What the handler needs from the outside world; index.ts passes the live ones, tests pass stubs. */
export interface TryonDeps {
  authenticate(req: Request): Promise<AuthResult>;
  /** Created only after authentication. Throws only when the server env is missing. */
  store(): TryonStore;
  monthlySpend(): Promise<number | null>;
  /** Whether this user's own monthly allowance (_shared/quota.ts) has room for a paid call. */
  userAllows(userId: string): Promise<boolean>;
  logAiCall(userId: string | null, entry: AiLogEntry): Promise<void>;
  renderOutfit: typeof renderOutfit;
  renderFigure: typeof renderFigure;
}

type Body = TryonQuoteResponse | TryonRenderResponse | TryonErrorResponse;
const json = (status: number, body: Body) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...cors } });

/** Client errors carry a 4xx status; budget, provider and storage outcomes are 200 with ok:false, like intake-separate. */
const STATUS: Record<TryonErrorCode, number> = {
  invalid_input: 400,
  unauthenticated: 401,
  item_not_found: 404,
  item_has_no_image: 422,
  budget_reached: 200,
  provider_refused: 200,
  provider_timeout: 200,
  provider_error: 200,
  storage_error: 200,
};
const error = (code: TryonErrorCode, extra: Omit<TryonErrorResponse, "ok" | "error"> = {}) => json(STATUS[code], { ok: false, error: code, ...extra });
const budgetReached = (spent: number | null) => error("budget_reached", { month_spend_usd: spent === null ? null : round(spent), budget_usd: MONTHLY_GOOGLE_BUDGET_USD });
const round = (usd: number) => Math.round(usd * 100_000) / 100_000;

async function sha256Hex(s: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** The stored image's path for these garments: `tryon/{uid}/{sha256 of the cache key input}.png`. */
export async function tryonImagePath(userId: string, itemIds: readonly string[]): Promise<string> {
  return `tryon/${userId}/${await sha256Hex(tryonCacheKeyInput(userId, itemIds, FIGURE_VERSION, TRYON_MODEL))}.png`;
}

/**
 * The `tryon` Edge Function (DESIGN.md "שלב 5.3" item 4): one image of an outfit on the fixed figure.
 *
 * Input (POST JSON, TryonRequestSchema): `{ mode: "quote" | "render" | "rerender", items: [{ item_id, slot }] }`.
 * - quote: price (plus the one-time figure while it is missing), the month's Google spend and cap, and whether an
 *   image for these garments is stored; when it is, its signed URL too (so opening the sheet never needs render).
 *   Never generates, never costs, writes nothing.
 * - render: the stored image when there is one (free); else generates, stores and returns it.
 * - rerender: always generates and replaces the stored image.
 * Before any generation: the shared monthly cap (spend + this call's price, unknown spend = spent), checked again
 * after the figure was made; and, for render, the stored image is looked for again right before paying, so a
 * second press after the first one finished does not pay twice. After every call that reached the provider, success
 * or not: one ai_calls row. No fallback to any other model or provider.
 *
 * Failure modes (TryonErrorResponse.error): unauthenticated (401), invalid_input (400: bad JSON, the outfit rule, a
 * garment whose stored category is not its slot), item_not_found (404: not the caller's, or no such id),
 * item_has_no_image (422: no cutout, or the file is missing), budget_reached, provider_refused, provider_timeout,
 * provider_error, storage_error (all 200 with ok:false).
 */
export async function handleTryon(req: Request, deps: TryonDeps): Promise<Response> {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return error("invalid_input");

  const auth = await deps.authenticate(req);
  if (!auth.ok) return error("unauthenticated");
  const { userId } = auth;

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return error("invalid_input");
  }
  const parsed = TryonRequestSchema.safeParse(raw);
  if (!parsed.success) return error("invalid_input");
  const { mode, items } = parsed.data;

  let store: TryonStore;
  try {
    store = deps.store();
  } catch (e) {
    console.error("tryon store", e instanceof Error ? e.message : String(e));
    return error("storage_error");
  }

  const ids = items.map((i) => i.item_id);
  const rows = await store.readItems(userId, ids);
  if (rows === null) return error("storage_error");
  for (const item of items) {
    const row = rows.find((r) => r.id === item.item_id);
    if (!row) return error("item_not_found", { item_id: item.item_id });
    if (!fillsSlot(row.category, item.slot)) return error("invalid_input", { item_id: item.item_id });
    if (!row.cutout_path) return error("item_has_no_image", { item_id: item.item_id });
  }

  const path = await tryonImagePath(userId, ids);
  const cached = await store.exists(path);
  if (cached === null) return error("storage_error");

  if (mode === "quote") {
    const figureExists = await store.exists(FIGURE_PATH);
    if (figureExists === null) return error("storage_error");
    // don't touch / quote is the only call the sheet makes without a press, so a stored image is signed right here:
    // the sheet then never calls render just to show it (render would pay if the image vanished in between).
    // Cached without a URL is never answered; a failed signature is storage_error.
    let stored: { image_url: string; expires_in_s: number } | null = null;
    if (cached) {
      const url = await store.signedUrl(path, SIGNED_URL_TTL_S);
      if (!url) return error("storage_error");
      stored = { image_url: url, expires_in_s: SIGNED_URL_TTL_S };
    }
    const spent = await deps.monthlySpend();
    return json(200, {
      ok: true,
      mode,
      price_usd: round(TRYON_PRICE_USD + (figureExists ? 0 : FIGURE_PRICE_USD)),
      includes_figure: !figureExists,
      month_spend_usd: spent === null ? null : round(spent),
      budget_usd: MONTHLY_GOOGLE_BUDGET_USD,
      cached,
      ...(stored ?? {}),
    });
  }

  // The month's spend before this press; the response reports it plus what this press cost.
  const spentBefore = await deps.monthlySpend();
  const answer = async (isCached: boolean, cost: number): Promise<Response> => {
    const url = await store.signedUrl(path, SIGNED_URL_TTL_S);
    if (!url) return error("storage_error");
    return json(200, {
      ok: true,
      mode,
      image_url: url,
      expires_in_s: SIGNED_URL_TTL_S,
      cached: isCached,
      cost_usd: round(cost),
      month_spend_usd: spentBefore === null ? null : round(spentBefore + cost),
      budget_usd: MONTHLY_GOOGLE_BUDGET_USD,
    });
  };

  if (mode === "render" && cached) return answer(true, 0);

  // A stored image costs nothing, so the user's own allowance is checked only here, before anything is paid. Over
  // it, the sheet shows its "budget reached" line; the numbers stay out because they are the user's, not the cap's.
  if (!(await deps.userAllows(userId))) return error("budget_reached", { month_spend_usd: null });

  // Garment images before any money is spent: a missing file must not cost a figure.
  const garments: TryonGarment[] = [];
  for (const item of items) {
    const row = rows.find((r) => r.id === item.item_id);
    if (!row?.cutout_path) return error("item_has_no_image", { item_id: item.item_id });
    const image = await store.readGarmentImage(row.cutout_path);
    if (!image) return error("item_has_no_image", { item_id: item.item_id });
    garments.push({
      slot: item.slot,
      subcategory: row.subcategory,
      color_name: row.color_name,
      color_hex: row.color_hex,
      pattern: row.pattern,
      material: row.material,
      formality: row.formality,
      image,
      mimeType: sniffImageType(image, "image/png"),
    });
  }

  const logged = async (result: TryonResult) => {
    if (result.ok || result.providerCalled) await deps.logAiCall(userId, result.log);
  };

  let spent = spentBefore;
  let spentThisPress = 0;

  let figure: { image: Uint8Array; mimeType: string };
  const figureExists = await store.exists(FIGURE_PATH);
  if (figureExists === null) return error("storage_error");
  if (figureExists) {
    const image = await store.download(FIGURE_PATH);
    if (!image) return error("storage_error");
    figure = { image, mimeType: sniffImageType(image, "image/png") };
  } else {
    // don't touch / the figure is only made when the outfit image can follow within the cap: a figure paid for and
    // then refused by the cap would be money spent on nothing the user sees.
    if (!googleBudgetAllows(spent, FIGURE_PRICE_USD + TRYON_PRICE_USD)) return budgetReached(spent);
    const made = await deps.renderFigure();
    await logged(made);
    if (!made.ok) return error(made.error);
    spentThisPress += made.log.cost_usd ?? FIGURE_PRICE_USD;
    // upsert false: if another first press stored a figure meanwhile, keep that one so every render uses one figure.
    const put = await store.upload(FIGURE_PATH, made.image, made.mimeType, false);
    if (put === "error") return error("storage_error");
    if (put === "exists") {
      const theirs = await store.download(FIGURE_PATH);
      if (!theirs) return error("storage_error");
      figure = { image: theirs, mimeType: sniffImageType(theirs, "image/png") };
    } else {
      figure = { image: made.image, mimeType: made.mimeType };
    }
    // Read again rather than trusted: another press may have spent meanwhile. Never below what is known to be spent,
    // in case this press's ai_calls row did not land.
    const fresh = await deps.monthlySpend();
    spent = fresh === null || spentBefore === null ? null : Math.max(fresh, spentBefore + spentThisPress);
  }

  if (!googleBudgetAllows(spent, TRYON_PRICE_USD)) return budgetReached(spent);

  // The double-press check: a first press that finished while this one read garments or drew the figure.
  if (mode === "render") {
    const now = await store.exists(path);
    if (now === null) return error("storage_error");
    if (now) return answer(true, spentThisPress);
  }

  const drawn = await deps.renderOutfit(garments, figure);
  await logged(drawn);
  if (!drawn.ok) return error(drawn.error);
  spentThisPress += drawn.log.cost_usd ?? TRYON_PRICE_USD;

  // upsert: rerender replaces by definition; for render, a concurrent press's image is equally fresh.
  const put = await store.upload(path, drawn.image, drawn.mimeType, true);
  if (put !== "ok") return error("storage_error");
  return answer(false, spentThisPress);
}
