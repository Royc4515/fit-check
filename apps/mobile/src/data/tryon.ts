import {
  TryonErrorResponseSchema,
  TryonQuoteResponseSchema,
  TryonRenderResponseSchema,
  type TryonItem,
  type TryonQuoteResponse,
  type TryonRenderResponse,
} from "@fit-check/schema";
import { FunctionsHttpError } from "@supabase/supabase-js";
import { flightKey, isLostAnswer, NO_ANSWER_MS, pendingLeftMs, singleFlight, withTimeout, type Failure, type PayMode } from "../features/tryon/model";
import { supabase } from "../lib/supabase";
import { isPreview } from "./preview";

/**
 * Data for the "על דמות" sheet (DESIGN.md "שלב 5.3"): the `tryon` Edge Function. Every answer is parsed with the
 * shared schema and mapped to one typed result; nothing here throws.
 */

export type QuoteResult = { ok: true; quote: TryonQuoteResponse } | { ok: false; failure: Failure };
export type RenderResult = { ok: true; render: TryonRenderResponse } | { ok: false; failure: Failure };

const PREVIEW: Failure = { reason: "preview" };

type Mode = "quote" | "render" | "rerender";

/** The server's error body, or the transport/shape failure, as a Failure. */
async function call(mode: Mode, items: readonly TryonItem[]): Promise<{ ok: true; data: unknown } | { ok: false; failure: Failure }> {
  try {
    const { data, error } = await supabase.functions.invoke("tryon", { body: { mode, items } });
    if (error) {
      if (error instanceof FunctionsHttpError) {
        // 4xx answers (invalid_input, unauthenticated, item_not_found, item_has_no_image) carry the typed body too.
        const body: unknown = await error.context.json().catch(() => null);
        const parsed = TryonErrorResponseSchema.safeParse(body);
        if (parsed.success) return { ok: false, failure: { reason: parsed.data.error, itemId: parsed.data.item_id } };
        // A gateway 5xx or any body that is not ours: no answer from the function.
        return { ok: false, failure: { reason: "bad_response" } };
      }
      return { ok: false, failure: { reason: "network" } };
    }
    return { ok: true, data };
  } catch (error) {
    console.error("tryon call failed", error);
    return { ok: false, failure: { reason: "network" } };
  }
}

/** A 200 body that is an `ok:false` error, as a Failure; null when the body is not one. */
function errorBody(data: unknown): Failure | null {
  const parsed = TryonErrorResponseSchema.safeParse(data);
  return parsed.success ? { reason: parsed.data.error, itemId: parsed.data.item_id } : null;
}

/**
 * The price, the month's spend and cap, and the stored image's address when there is one. Free and never generates:
 * the only call the sheet makes without a press on a paying button. In the design preview: a typed "preview" result
 * and no request at all.
 * Failure modes (all as `{ ok: false, failure }`): the server's error codes, "network", "bad_response".
 */
export async function quoteTryOn(items: readonly TryonItem[]): Promise<QuoteResult> {
  // Design preview: no Edge Function call, paid or not.
  if (isPreview()) return { ok: false, failure: PREVIEW };
  const r = await call("quote", items);
  if (!r.ok) return r;
  const parsed = TryonQuoteResponseSchema.safeParse(r.data);
  if (parsed.success) return { ok: true, quote: parsed.data };
  return { ok: false, failure: errorBody(r.data) ?? { reason: "bad_response" } };
}

const inFlight = new Map<string, Promise<RenderResult>>();
/**
 * Paying requests that ended WITHOUT an answer, per outfit: the generation may still be running and will be charged,
 * so the sheet offers no second paying press until the window closes (`PENDING_WINDOW_S` after the request was SENT).
 * Module-level on purpose: it survives closing the sheet and switching day tabs. It does NOT survive a page reload
 * (nothing is stored); after a reload the first quote's `cached` is all the sheet knows.
 */
const pending = new Map<string, { sentAt: number; mode: PayMode }>();

/** The running paying request for exactly these garments in this tab, if any (the sheet was closed and reopened). */
export function runningTryOn(items: readonly TryonItem[]): Promise<RenderResult> | null {
  return inFlight.get(flightKey(items)) ?? null;
}

/** The lost-answer window still open for these garments, or null (expired windows are forgotten here). */
export function pendingTryOn(items: readonly TryonItem[], now: number): { sentAt: number; mode: PayMode } | null {
  const key = flightKey(items);
  const p = pending.get(key);
  if (!p) return null;
  if (pendingLeftMs(p.sentAt, now) <= 0) {
    pending.delete(key);
    return null;
  }
  return p;
}

/** Ends the window for these garments early (a quote showed the image) or when it is over. */
export function clearTryOnPending(items: readonly TryonItem[]): void {
  pending.delete(flightKey(items));
}

/**
 * PAYS (about $0.055, plus the one-time figure the first time): `again` false = the stored image if there is one,
 * else a new one; `again` true = always a new one, costs again. At most one running request per set of garments: a
 * second call while one runs gets the same answer instead of a second payment. In the design preview: a typed
 * "preview" result and no request at all.
 * Failure modes (as `{ ok: false, failure }`): budget_reached, provider_*, storage_error, item_*, invalid_input,
 * unauthenticated; and the LOST answers ("network", "bad_response", or no answer within `NO_ANSWER_MS`), which carry
 * `sentAt` and open the pending window above (the server may still finish and charge).
 */
export function renderTryOn(items: readonly TryonItem[], { again }: { again: boolean }): Promise<RenderResult> {
  if (isPreview()) return Promise.resolve({ ok: false, failure: PREVIEW });
  const key = flightKey(items);
  return singleFlight(inFlight, key, async (): Promise<RenderResult> => {
    const sentAt = Date.now();
    const mode: PayMode = again ? "rerender" : "render";
    const lost = (reason: "network" | "bad_response"): RenderResult => {
      pending.set(key, { sentAt, mode });
      return { ok: false, failure: { reason, sentAt } };
    };
    const run = async (): Promise<RenderResult> => {
      const r = await call(mode, items);
      if (!r.ok) return isLostAnswer({ ...r.failure, sentAt }) ? lost(r.failure.reason === "bad_response" ? "bad_response" : "network") : r;
      const parsed = TryonRenderResponseSchema.safeParse(r.data);
      if (parsed.success) return { ok: true, render: parsed.data };
      const typed = errorBody(r.data);
      return typed ? { ok: false, failure: typed } : lost("bad_response");
    };
    // The request is not cancelled on timeout (it may still be charged): hence a lost answer, not a failure.
    const result = await withTimeout(run(), NO_ANSWER_MS, () => lost("network"));
    // The server answered (typed): the window, if an earlier request opened one, is over.
    if (result.ok || !isLostAnswer(result.failure)) pending.delete(key);
    return result;
  });
}
