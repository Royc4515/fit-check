import {
  TryonErrorResponseSchema,
  TryonQuoteResponseSchema,
  TryonRenderResponseSchema,
  type TryonItem,
  type TryonQuoteResponse,
  type TryonRenderResponse,
} from "@fit-check/schema";
import { FunctionsHttpError } from "@supabase/supabase-js";
import { flightKey, singleFlight, type Failure } from "../features/tryon/model";
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

/** The running paying request for exactly these garments in this tab, if any (the sheet was closed and reopened). */
export function runningTryOn(items: readonly TryonItem[]): Promise<RenderResult> | null {
  return inFlight.get(flightKey(items)) ?? null;
}

/**
 * PAYS (about $0.055, plus the one-time figure the first time): `again` false = the stored image if there is one,
 * else a new one; `again` true = always a new one, costs again. At most one running request per set of garments: a
 * second call while one runs gets the same answer instead of a second payment. In the design preview: a typed
 * "preview" result and no request at all.
 * Failure modes (as `{ ok: false, failure }`): budget_reached, provider_*, storage_error, item_*, invalid_input,
 * unauthenticated, "network" (the call never completed; the server may still have finished), "bad_response".
 */
export function renderTryOn(items: readonly TryonItem[], { again }: { again: boolean }): Promise<RenderResult> {
  if (isPreview()) return Promise.resolve({ ok: false, failure: PREVIEW });
  return singleFlight(inFlight, flightKey(items), async (): Promise<RenderResult> => {
    const r = await call(again ? "rerender" : "render", items);
    if (!r.ok) return r;
    const parsed = TryonRenderResponseSchema.safeParse(r.data);
    if (parsed.success) return { ok: true, render: parsed.data };
    return { ok: false, failure: errorBody(r.data) ?? { reason: "bad_response" } };
  });
}
