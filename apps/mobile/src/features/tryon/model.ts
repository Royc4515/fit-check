import { TryonRequestSchema, type Slot, type TryonErrorCode, type TryonItem, type TryonQuoteResponse, type TryonRenderResponse } from "@fit-check/schema";

/**
 * Pure logic of the "על דמות" sheet (DESIGN.md "שלב 5.3" item 2): what each state shows, the price line's parts,
 * when a signed address must be asked for again, and the reducer that makes a paying press impossible twice.
 * No I/O and no clock: time comes in as an argument so the tests are deterministic.
 */

/** Why a request did not give what was asked: the server's codes plus the client's own. */
export type FailureReason = TryonErrorCode | "network" | "bad_response" | "preview" | "image_load";
export type Failure = { reason: FailureReason; itemId?: string };

/** The numbers a quote carries, in the app's names. */
export type Quote = { priceUsd: number; includesFigure: boolean; monthSpendUsd: number | null; budgetUsd: number };
/** A stored image's signed address and when it was received (ms), so its age can be judged. */
export type StoredImage = { url: string; expiresInS: number; at: number };

/** What the sheet is doing. `preview`: the read-only design preview, where nothing is ever requested. */
export type Phase = "quoting" | "ready" | "generating" | "result" | "failed" | "preview";
/** What the paying button asks the server for: first image, or a repeat that costs again. */
export type PayMode = "render" | "rerender";

export type TryOnState = {
  phase: Phase;
  quote: Quote | null;
  image: StoredImage | null;
  failure: Failure | null;
  /** What "try again" does after a failure; null = nothing a retry could change. */
  retry: "quote" | PayMode | null;
  /** The paying request in flight, or the one that just failed. */
  paying: PayMode | null;
  /** Times a stored image failed to load since the last good quote: one silent re-ask, then an error. */
  imageErrors: number;
};

export const INITIAL: TryOnState = { phase: "quoting", quote: null, image: null, failure: null, retry: null, paying: null, imageErrors: 0 };

export type TryOnAction =
  | { type: "open" }
  /** Reopened while a paying request of this device is still running: show it as generating, never offer the button. */
  | { type: "open_in_flight"; mode: PayMode }
  | { type: "quote_ok"; quote: Quote; image: StoredImage | null }
  | { type: "quote_failed"; failure: Failure }
  | { type: "press"; mode: PayMode }
  | { type: "retry" }
  | { type: "render_ok"; image: StoredImage; monthSpendUsd: number | null; budgetUsd: number }
  | { type: "render_failed"; failure: Failure }
  /** The stored image would not load, or its address is older than it said: ask `quote` again (free). */
  | { type: "image_stale" };

/** Reasons where asking again cannot change the answer (or would pay for nothing): no retry button. */
const NO_RETRY: ReadonlySet<FailureReason> = new Set<FailureReason>([
  "budget_reached",
  "item_has_no_image",
  "item_not_found",
  "invalid_input",
  "unauthenticated",
  "preview",
]);

/**
 * What "try again" does for a failure.
 * don't touch / after a paying request whose answer never arrived (network, unparsable body) the server may well have
 * finished and stored the image, so the retry is the FREE quote, which shows it; going straight back to render could
 * pay a second time for the same picture.
 */
export function retryFor(failure: Failure, during: "quote" | PayMode): "quote" | PayMode | null {
  if (NO_RETRY.has(failure.reason)) return null;
  if (during === "quote") return "quote";
  if (failure.reason === "network" || failure.reason === "bad_response" || failure.reason === "image_load") return "quote";
  return during;
}

const roundUsd = (n: number) => Math.round(n * 100_000) / 100_000;

/** Money left this month; null when the spend is unknown. Never negative. */
export function leftUsd(q: Quote): number | null {
  return q.monthSpendUsd === null ? null : Math.max(0, roundUsd(q.budgetUsd - q.monthSpendUsd));
}

/** Whether the paying button may be shown: the balance is known and covers one image (the server checks again). */
export function canGenerate(q: Quote): boolean {
  const left = leftUsd(q);
  return left !== null && left >= q.priceUsd;
}

/** What the paying area shows: the price with the balance, the price with an unknown balance, or the budget line. */
export type PriceLine =
  | { kind: "known"; price: number; left: number; budget: number; includesFigure: boolean }
  | { kind: "unknown"; price: number; includesFigure: boolean }
  | { kind: "budget_reached" };

/** The price line's parts, from the quote's numbers only (nothing hard-coded). */
export function priceLine(q: Quote): PriceLine {
  const left = leftUsd(q);
  if (left === null) return { kind: "unknown", price: q.priceUsd, includesFigure: q.includesFigure };
  if (left < q.priceUsd) return { kind: "budget_reached" };
  return { kind: "known", price: q.priceUsd, left, budget: q.budgetUsd, includesFigure: q.includesFigure };
}

/**
 * A US-dollar amount with as many decimals as the server sent: "$0.055", "$7.20", "$8". Always en-US, not the UI
 * language: Hebrew's currency pattern puts the sign after the number ("7.20 $"), which the spec's line does not.
 * The caller isolates it left-to-right inside running text.
 */
export function formatUsd(n: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: Number.isInteger(n) ? 0 : 2,
    maximumFractionDigits: 5,
  }).format(n);
}

/** Safety margin before the stated expiry: a slow image request must not start with an address about to die. */
export const EXPIRY_MARGIN_S = 30;

/** True when a stored image's address should be asked for again (older than it said, less the margin). */
export function addressExpired(image: StoredImage, now: number): boolean {
  return now >= image.at + (image.expiresInS - EXPIRY_MARGIN_S) * 1000;
}

/** Milliseconds until `addressExpired` turns true; 0 when it already is. */
export function msUntilExpiry(image: StoredImage, now: number): number {
  return Math.max(0, image.at + (image.expiresInS - EXPIRY_MARGIN_S) * 1000 - now);
}

/** A garment of the outfit on screen. */
export type OutfitPiece = { id: string; slot: Slot };

/**
 * The garments to send, or null when the outfit cannot be drawn (no entry shown): the server needs exactly one top,
 * one bottom and one pair of shoes, at most one layer, 3 to 4 garments (Yom Kippur planned without shoes has none).
 * Validated with the shared request schema so the app and the function cannot disagree.
 */
export function tryonItemsOf(pieces: readonly OutfitPiece[]): TryonItem[] | null {
  const items = pieces.map((p) => ({ item_id: p.id, slot: p.slot }));
  const parsed = TryonRequestSchema.safeParse({ mode: "quote", items });
  return parsed.success ? parsed.data.items : null;
}

/** Quote response to the state's own names. */
export function quoteOf(r: TryonQuoteResponse): Quote {
  return { priceUsd: r.price_usd, includesFigure: r.includes_figure, monthSpendUsd: r.month_spend_usd, budgetUsd: r.budget_usd };
}

/** The stored image carried by a quote or a render response, stamped with the time it arrived. */
export function imageOf(r: Pick<TryonQuoteResponse | TryonRenderResponse, "image_url" | "expires_in_s">, now: number): StoredImage | null {
  return r.image_url !== undefined && r.expires_in_s !== undefined ? { url: r.image_url, expiresInS: r.expires_in_s, at: now } : null;
}

/** Whether a paying press is accepted in this state, for this mode. */
export function mayPress(s: TryOnState, mode: PayMode): boolean {
  if (s.quote === null || !canGenerate(s.quote)) return false;
  if (mode === "render") return s.phase === "ready";
  return s.phase === "result";
}

/**
 * The sheet's state machine. A rejected action returns the SAME object, so a caller can tell "nothing happened" by
 * identity and must then send no request: that is the guard against a second paying press while one is in flight
 * (also across two presses in the same tick, when the component feeds it the latest state, not a rendered copy).
 */
export function reduceTryOn(s: TryOnState, a: TryOnAction): TryOnState {
  switch (a.type) {
    case "open":
      return INITIAL;
    case "open_in_flight":
      return { ...INITIAL, phase: "generating", paying: a.mode };
    case "quote_ok": {
      // A quote that lands while a paying request runs is stale news; the render's own answer decides.
      if (s.phase === "generating") return s;
      return { ...s, phase: a.image ? "result" : "ready", quote: a.quote, image: a.image, failure: null, retry: null, paying: null, imageErrors: 0 };
    }
    case "quote_failed": {
      if (s.phase === "generating") return s;
      if (a.failure.reason === "preview") return { ...INITIAL, phase: "preview", failure: a.failure };
      return { ...s, phase: "failed", failure: a.failure, retry: retryFor(a.failure, "quote"), paying: null };
    }
    case "press":
      if (!mayPress(s, a.mode)) return s;
      return { ...s, phase: "generating", paying: a.mode, failure: null, retry: null };
    case "retry": {
      if (s.phase !== "failed" || s.retry === null) return s;
      if (s.retry === "quote") return { ...s, phase: "quoting", failure: null, retry: null, paying: null };
      return reduceTryOn({ ...s, phase: s.retry === "render" ? "ready" : "result", failure: null, retry: null }, { type: "press", mode: s.retry });
    }
    case "render_ok":
      if (s.phase !== "generating") return s;
      return {
        ...s,
        phase: "result",
        image: a.image,
        failure: null,
        retry: null,
        paying: null,
        imageErrors: 0,
        quote: s.quote ? { ...s.quote, monthSpendUsd: a.monthSpendUsd, budgetUsd: a.budgetUsd, includesFigure: false } : s.quote,
      };
    case "render_failed": {
      if (s.phase !== "generating") return s;
      return { ...s, phase: "failed", failure: a.failure, retry: retryFor(a.failure, s.paying ?? "render") };
    }
    case "image_stale": {
      if (s.phase !== "result" && s.phase !== "failed") return s;
      if (s.imageErrors >= 1) {
        const failure: Failure = { reason: "image_load" };
        return { ...s, phase: "failed", image: null, failure, retry: retryFor(failure, "quote"), imageErrors: s.imageErrors + 1 };
      }
      return { ...s, phase: "quoting", image: null, failure: null, retry: null, imageErrors: s.imageErrors + 1 };
    }
  }
}

/** Whether the "failed" phase still shows the paying line (a failed paying request can be pressed again). */
export function showsPayAgain(s: TryOnState): boolean {
  return s.phase === "failed" && (s.retry === "render" || s.retry === "rerender");
}

/** The widest the picture may be so that the sheet's other lines still fit under the sheet's height cap. */
export function imageMaxWidth(windowHeight: number, reserved: number, aspect = 1.25): number {
  return Math.max(160, Math.floor((windowHeight * 0.85 - reserved) / aspect));
}

/**
 * Runs `start` unless a paying request for the same garments is already running, in which case the running one is
 * returned: two presses, or a reopened sheet, can never become two payments.
 */
export function singleFlight<T>(inFlight: Map<string, Promise<T>>, key: string, start: () => Promise<T>): Promise<T> {
  const running = inFlight.get(key);
  if (running) return running;
  const p = start().finally(() => {
    inFlight.delete(key);
  });
  inFlight.set(key, p);
  return p;
}

/** One key per set of garments, whatever their order. */
export const flightKey = (items: readonly TryonItem[]): string => items.map((i) => i.item_id).sort().join(",");
