import { TryonRequestSchema, type Slot, type TryonErrorCode, type TryonItem, type TryonQuoteResponse, type TryonRenderResponse } from "@fit-check/schema";

/**
 * Pure logic of the "על דמות" sheet (DESIGN.md "שלב 5.3" item 2): what each state shows, the price line's parts,
 * when a signed address must be asked for again, and the reducer that makes a paying press impossible twice.
 * No I/O and no clock: time comes in as an argument so the tests are deterministic.
 */

/** Why a request did not give what was asked: the server's codes plus the client's own. */
export type FailureReason = TryonErrorCode | "network" | "bad_response" | "preview" | "image_load";
/** `sentAt` (ms) is set only on a paying request that ended WITHOUT an answer: see `isLostAnswer`. */
export type Failure = { reason: FailureReason; itemId?: string; sentAt?: number };

/**
 * A paying request that ended without the server's answer (connection lost, a body that is not the schema, the browser
 * or the app giving up): the generation may still be running and will be charged, so the sheet must not offer a second
 * paying press for the same outfit until `PENDING_WINDOW_S` after the request was sent.
 */
export const isLostAnswer = (f: Failure): f is Failure & { sentAt: number } =>
  f.sentAt !== undefined && (f.reason === "network" || f.reason === "bad_response");

/** How long after SENDING a paying request its generation may still be running (the function's own limit plus slack). */
export const PENDING_WINDOW_S = 120;
/** How often the sheet asks the free `quote` while a lost answer's window is open. */
export const PENDING_POLL_MS = 15_000;
/** A paying request with no answer at all for this long counts as a lost answer (inside the window, with slack). */
export const NO_ANSWER_MS = 100_000;

/** Milliseconds left of a pending window that opened when the request was sent; 0 when it is over. */
export const pendingLeftMs = (sentAt: number, now: number): number => Math.max(0, sentAt + PENDING_WINDOW_S * 1000 - now);

/** The numbers a quote carries, in the app's names. */
export type Quote = { priceUsd: number; includesFigure: boolean; monthSpendUsd: number | null; budgetUsd: number };
/** A stored image's signed address and when it was received (ms), so its age can be judged. */
export type StoredImage = { url: string; expiresInS: number; at: number };

/** What the sheet is doing. `preview`: the read-only design preview. `pending`: a paying request's answer was lost. */
export type Phase = "quoting" | "ready" | "generating" | "pending" | "result" | "failed" | "preview";
/** What the paying button asks the server for: first image, or a repeat that costs again. */
export type PayMode = "render" | "rerender";

export type TryOnState = {
  phase: Phase;
  quote: Quote | null;
  image: StoredImage | null;
  failure: Failure | null;
  /** What "try again" does after a failure; null = nothing a retry could change. */
  retry: "quote" | PayMode | null;
  /** The paying request in flight, pending, or the one that just failed. */
  paying: PayMode | null;
  /** Times a stored image failed to load since the sheet opened (or the last render / manual retry): one silent re-ask, then an error. */
  imageErrors: number;
  /** Counts every accepted event. A quote carries the number it started at and is dropped if anything happened since. */
  seq: number;
  /** When the lost paying request was sent (ms); set exactly in `pending`. */
  pendingSince: number | null;
  /** A pending window ended with no image: the ready state says a new image is charged again. */
  warnLost: boolean;
  /** The result just arrived from a paying request: announced once to screen readers. */
  fresh: boolean;
};

export const INITIAL: TryOnState = {
  phase: "quoting",
  quote: null,
  image: null,
  failure: null,
  retry: null,
  paying: null,
  imageErrors: 0,
  seq: 0,
  pendingSince: null,
  warnLost: false,
  fresh: false,
};

export type TryOnAction =
  /** The sheet opened, or the outfit changed under an open sheet: everything shown is dropped, earlier quotes are stale. */
  | { type: "open" }
  /** Reopened while a paying request of this tab is still running: show it as generating, never offer the button. */
  | { type: "open_in_flight"; mode: PayMode }
  /** Reopened inside a lost answer's window (same outfit): pending, never the button. */
  | { type: "open_pending"; mode: PayMode; sentAt: number }
  /** A quote is about to be sent: the returned state's `seq` is its ticket. */
  | { type: "quote_start" }
  | { type: "quote_ok"; ticket: number; quote: Quote; image: StoredImage | null }
  /** `background`: a refresh behind a screen that is already right (after a render, on expiry, polling): its failure shows nothing. */
  | { type: "quote_failed"; ticket: number; failure: Failure; background?: boolean }
  | { type: "press"; mode: PayMode }
  | { type: "retry" }
  | { type: "render_ok"; image: StoredImage; monthSpendUsd: number | null; budgetUsd: number }
  | { type: "render_failed"; failure: Failure }
  /** The pending window ended without the image. */
  | { type: "pending_over" }
  /** The stored image would not load, or its address is older than it said: ask `quote` again (free). */
  | { type: "image_stale" };

/** Reasons where asking again cannot change the answer (or would pay for nothing): no retry button. */
const NO_RETRY: ReadonlySet<FailureReason> = new Set<FailureReason>([
  "budget_reached",
  "item_has_no_image",
  "item_not_found",
  "invalid_input",
  "unauthenticated",
  "provider_refused",
  "preview",
]);

/**
 * What "try again" does for a failure the server (or the quote) reported.
 * A refusal has none: it would refuse again and every try is charged. A lost paying answer never gets here: it is
 * `pending`, not failed.
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
  | { kind: "budget_reached"; left: number };

/** The price line's parts, from the quote's numbers only (nothing hard-coded). */
export function priceLine(q: Quote): PriceLine {
  const left = leftUsd(q);
  if (left === null) return { kind: "unknown", price: q.priceUsd, includesFigure: q.includesFigure };
  if (left < q.priceUsd) return { kind: "budget_reached", left };
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
 * Every accepted event bumps `seq`, and a quote answer is accepted only if nothing happened since it started.
 */
export function reduceTryOn(s: TryOnState, a: TryOnAction): TryOnState {
  const next = (patch: Partial<TryOnState>): TryOnState => ({ ...s, ...patch, seq: s.seq + 1 });
  switch (a.type) {
    case "open":
      return { ...INITIAL, seq: s.seq + 1 };
    case "open_in_flight":
      return { ...INITIAL, seq: s.seq + 1, phase: "generating", paying: a.mode };
    case "open_pending":
      return { ...INITIAL, seq: s.seq + 1, phase: "pending", paying: a.mode, pendingSince: a.sentAt };
    case "quote_start":
      return next({});
    case "quote_ok": {
      if (a.ticket !== s.seq || s.phase === "generating") return s;
      if (s.phase === "pending") {
        // A repeat's old image is "cached" the whole time: only the window's end (or a new address) ends it.
        if (a.image && s.paying !== "rerender") return next({ phase: "result", quote: a.quote, image: a.image, pendingSince: null, paying: null, warnLost: false, fresh: true, imageErrors: 0 });
        return next({ quote: a.quote, image: s.paying === "rerender" ? (a.image ?? s.image) : s.image });
      }
      // imageErrors is NOT reset here: an image that keeps failing after fresh addresses must end in an error, not loop.
      return next({ phase: a.image ? "result" : "ready", quote: a.quote, image: a.image, failure: null, retry: null, paying: null, warnLost: a.image ? false : s.warnLost });
    }
    case "quote_failed": {
      if (a.ticket !== s.seq || s.phase === "generating" || s.phase === "pending" || a.background) return s;
      if (a.failure.reason === "preview") return { ...INITIAL, seq: s.seq + 1, phase: "preview", failure: a.failure };
      return next({ phase: "failed", failure: a.failure, retry: retryFor(a.failure, "quote"), paying: null });
    }
    case "press":
      if (!mayPress(s, a.mode)) return s;
      return next({ phase: "generating", paying: a.mode, failure: null, retry: null, warnLost: false, fresh: false });
    case "retry": {
      if (s.phase !== "failed" || s.retry === null) return s;
      if (s.retry === "quote") return next({ phase: "quoting", failure: null, retry: null, paying: null, imageErrors: 0 });
      return reduceTryOn({ ...s, seq: s.seq + 1, phase: s.retry === "render" ? "ready" : "result", failure: null, retry: null }, { type: "press", mode: s.retry });
    }
    case "render_ok":
      if (s.phase !== "generating") return s;
      return next({
        phase: "result",
        image: a.image,
        failure: null,
        retry: null,
        paying: null,
        imageErrors: 0,
        fresh: true,
        quote: s.quote ? { ...s.quote, monthSpendUsd: a.monthSpendUsd, budgetUsd: a.budgetUsd, includesFigure: false } : s.quote,
      });
    case "render_failed": {
      if (s.phase !== "generating") return s;
      if (isLostAnswer(a.failure)) return next({ phase: "pending", failure: null, retry: null, pendingSince: a.failure.sentAt });
      return next({ phase: "failed", failure: a.failure, retry: retryFor(a.failure, s.paying ?? "render") });
    }
    case "pending_over": {
      if (s.phase !== "pending") return s;
      const phase: Phase = s.paying === "rerender" ? "result" : s.quote ? "ready" : "quoting";
      return next({ phase, pendingSince: null, paying: null, warnLost: true });
    }
    case "image_stale": {
      if (s.phase !== "result" && s.phase !== "failed") return s;
      if (s.imageErrors >= 1) {
        const failure: Failure = { reason: "image_load" };
        return next({ phase: "failed", image: null, failure, retry: retryFor(failure, "quote"), imageErrors: s.imageErrors + 1, fresh: false });
      }
      return next({ phase: "quoting", image: null, failure: null, retry: null, imageErrors: s.imageErrors + 1, fresh: false });
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

/**
 * Races a paying request against `ms`: when nothing came back in time the result is `onTimeout()`. The request itself
 * is not cancelled (it may still be charged), which is why the caller treats the timeout as a lost answer.
 */
export function withTimeout<T>(p: Promise<T>, ms: number, onTimeout: () => T): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => resolve(onTimeout()), ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e: unknown) => {
        clearTimeout(timer);
        reject(e instanceof Error ? e : new Error(String(e)));
      }
    );
  });
}
