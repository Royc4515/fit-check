import { describe, expect, it, vi } from "vitest";
import {
  addressExpired,
  canGenerate,
  flightKey,
  formatUsd,
  imageMaxWidth,
  imageOf,
  INITIAL,
  isLostAnswer,
  leftUsd,
  mayPress,
  msUntilExpiry,
  pendingLeftMs,
  PENDING_WINDOW_S,
  priceLine,
  quoteOf,
  reduceTryOn,
  retryFor,
  singleFlight,
  tryonItemsOf,
  withTimeout,
  type Failure,
  type Quote,
  type StoredImage,
  type TryOnAction,
  type TryOnState,
} from "./model";

const id = (n: number) => `00000000-0000-4000-8000-00000000000${n}`;
const quote = (over: Partial<Quote> = {}): Quote => ({ priceUsd: 0.055, includesFigure: false, monthSpendUsd: 0.8, budgetUsd: 8, ...over });
const img = (at = 1000): StoredImage => ({ url: "https://x.test/a.png", expiresInS: 600, at });
const act = (s: TryOnState, a: TryOnAction) => reduceTryOn(s, a);

/** A quote sent and answered: start (the ticket is the state's seq), then the answer. */
const quoted = (s: TryOnState, q: Quote, image: StoredImage | null = null): TryOnState => {
  const started = act(s, { type: "quote_start" });
  return act(started, { type: "quote_ok", ticket: started.seq, quote: q, image });
};
const quoteFailed = (s: TryOnState, failure: Failure, background = false): TryOnState => {
  const started = act(s, { type: "quote_start" });
  return act(started, { type: "quote_failed", ticket: started.seq, failure, background });
};
const ready = (q = quote()): TryOnState => quoted(INITIAL, q);
const result = (): TryOnState => quoted(INITIAL, quote(), img());
const generating = (s = ready(), mode: "render" | "rerender" = "render") => act(s, { type: "press", mode });
const lost = (sentAt = 5000): Failure => ({ reason: "network", sentAt });
/** A render whose answer was lost: pending. */
const pending = (sentAt = 5000) => act(generating(), { type: "render_failed", failure: lost(sentAt) });

describe("formatUsd", () => {
  it("shows cents and fractions of a cent as sent", () => {
    expect(formatUsd(0.055)).toBe("$0.055");
    expect(formatUsd(7.2)).toBe("$7.20");
    expect(formatUsd(8)).toBe("$8");
    expect(formatUsd(0.102)).toBe("$0.102");
    expect(formatUsd(0.1)).toBe("$0.10");
  });
});

describe("price line", () => {
  it("is built from the quote's numbers", () => {
    expect(priceLine(quote({ monthSpendUsd: 0.8 }))).toEqual({ kind: "known", price: 0.055, left: 7.2, budget: 8, includesFigure: false });
  });
  it("carries the one-time figure flag", () => {
    expect(priceLine(quote({ priceUsd: 0.102, includesFigure: true }))).toMatchObject({ kind: "known", includesFigure: true });
  });
  it("says the balance is unknown when the spend is null, and hides the paying button", () => {
    const q = quote({ monthSpendUsd: null });
    expect(priceLine(q)).toEqual({ kind: "unknown", price: 0.055, includesFigure: false });
    expect(leftUsd(q)).toBeNull();
    expect(canGenerate(q)).toBe(false);
    expect(mayPress(ready(q), "render")).toBe(false);
  });
  it("is the budget line when the rest does not cover one image, with what is left", () => {
    expect(priceLine(quote({ monthSpendUsd: 7.99 }))).toEqual({ kind: "budget_reached", left: 0.01 });
    expect(priceLine(quote({ monthSpendUsd: 9 }))).toEqual({ kind: "budget_reached", left: 0 });
    expect(priceLine(quote({ monthSpendUsd: 7.945 }))).toMatchObject({ kind: "known" });
  });
});

describe("signed address", () => {
  it("expires a margin before its stated time", () => {
    const i = img(1000);
    expect(addressExpired(i, 1000)).toBe(false);
    expect(addressExpired(i, 1000 + 569_000)).toBe(false);
    expect(addressExpired(i, 1000 + 570_000)).toBe(true);
    expect(msUntilExpiry(i, 1000)).toBe(570_000);
    expect(msUntilExpiry(i, 10_000_000)).toBe(0);
  });
  it("reads the image off a quote only when both fields are there", () => {
    expect(imageOf({ image_url: "https://x.test/a.png", expires_in_s: 600 }, 5)).toEqual({ url: "https://x.test/a.png", expiresInS: 600, at: 5 });
    expect(imageOf({}, 5)).toBeNull();
  });
  it("maps a quote response", () => {
    expect(quoteOf({ ok: true, mode: "quote", price_usd: 0.1, includes_figure: true, month_spend_usd: null, budget_usd: 8, cached: false })).toEqual({
      priceUsd: 0.1,
      includesFigure: true,
      monthSpendUsd: null,
      budgetUsd: 8,
    });
  });
});

describe("tryonItemsOf", () => {
  const top = { id: id(1), slot: "top" as const };
  const bottom = { id: id(2), slot: "bottom" as const };
  const shoes = { id: id(3), slot: "shoes" as const };
  const layer = { id: id(4), slot: "layer" as const };
  it("accepts top, bottom, shoes and an optional layer", () => {
    expect(tryonItemsOf([top, bottom, shoes])).toHaveLength(3);
    expect(tryonItemsOf([top, bottom, shoes, layer])).toHaveLength(4);
  });
  it("refuses an outfit without shoes or incomplete", () => {
    expect(tryonItemsOf([top, bottom])).toBeNull();
    expect(tryonItemsOf([top, bottom, layer])).toBeNull();
    expect(tryonItemsOf([])).toBeNull();
  });
  it("refuses two tops", () => {
    expect(tryonItemsOf([top, { id: id(5), slot: "top" }, bottom, shoes])).toBeNull();
  });
});

describe("reducer: opening", () => {
  it("starts in quoting, with no price and no image", () => {
    expect(act(result(), { type: "open" })).toMatchObject({ phase: "quoting", quote: null, image: null });
  });
  it("shows a stored image from the quote", () => {
    const s = result();
    expect(s.phase).toBe("result");
    expect(s.image?.url).toBe("https://x.test/a.png");
  });
  it("shows the price and a paying button when nothing is stored", () => {
    expect(ready().phase).toBe("ready");
  });
  it("shows the preview state and nothing to press", () => {
    const s = quoteFailed(INITIAL, { reason: "preview" });
    expect(s.phase).toBe("preview");
    expect(s.retry).toBeNull();
    expect(act(s, { type: "press", mode: "render" })).toBe(s);
  });
  it("a failed quote is retried with a quote", () => {
    const s = quoteFailed(INITIAL, { reason: "network" });
    expect(s).toMatchObject({ phase: "failed", retry: "quote" });
    expect(act(s, { type: "retry" }).phase).toBe("quoting");
  });
  it("reopening while a request runs is generating, never a paying button", () => {
    const s = act(INITIAL, { type: "open_in_flight", mode: "render" });
    expect(s.phase).toBe("generating");
    expect(quoted(s, quote())).toMatchObject({ phase: "generating", quote: null, image: null });
    expect(mayPress(s, "render")).toBe(false);
  });
});

describe("reducer: the paying press cannot happen twice", () => {
  it("accepts the first press and rejects the second by identity", () => {
    const b = generating();
    expect(b.phase).toBe("generating");
    expect(act(b, { type: "press", mode: "render" })).toBe(b);
    expect(act(b, { type: "press", mode: "rerender" })).toBe(b);
  });
  it("rejects a press while quoting or with the budget spent", () => {
    expect(act(INITIAL, { type: "press", mode: "render" })).toBe(INITIAL);
    const spent = ready(quote({ monthSpendUsd: 8 }));
    expect(act(spent, { type: "press", mode: "render" })).toBe(spent);
  });
  it("again is only from a result, render only from ready", () => {
    expect(act(ready(), { type: "press", mode: "rerender" }).phase).toBe("ready");
    expect(act(result(), { type: "press", mode: "render" }).phase).toBe("result");
    expect(act(result(), { type: "press", mode: "rerender" }).phase).toBe("generating");
  });
  it("a retry after a paid failure is one more guarded press", () => {
    const f = act(generating(), { type: "render_failed", failure: { reason: "provider_timeout" } });
    expect(f).toMatchObject({ phase: "failed", retry: "render" });
    const again = act(f, { type: "retry" });
    expect(again.phase).toBe("generating");
    expect(act(again, { type: "retry" })).toBe(again);
  });
  it("a late answer outside generating is ignored", () => {
    const s = ready();
    expect(act(s, { type: "render_ok", image: img(), monthSpendUsd: 1, budgetUsd: 8 })).toBe(s);
    expect(act(s, { type: "render_failed", failure: { reason: "provider_error" } })).toBe(s);
  });
});

describe("reducer: results and failures", () => {
  it("a render gives a fresh result with the new balance, and the figure no longer in the price", () => {
    const g = generating(ready(quote({ priceUsd: 0.102, includesFigure: true })));
    const r = act(g, { type: "render_ok", image: img(), monthSpendUsd: 0.9, budgetUsd: 8 });
    expect(r.phase).toBe("result");
    expect(r.fresh).toBe(true);
    expect(r.quote).toMatchObject({ monthSpendUsd: 0.9, includesFigure: false });
  });
  it("no retry for budget, no cutout, unknown garment, bad input, sign-in, or a refusal", () => {
    for (const reason of ["budget_reached", "item_has_no_image", "item_not_found", "invalid_input", "unauthenticated", "provider_refused"] as const) {
      const f = act(generating(), { type: "render_failed", failure: { reason } });
      expect(f.retry).toBeNull();
      expect(act(f, { type: "retry" })).toBe(f);
    }
  });
  it("a timeout, a provider error or a storage error keep their (paying) retry", () => {
    for (const reason of ["provider_timeout", "provider_error", "storage_error"] as const) {
      expect(act(generating(), { type: "render_failed", failure: { reason } }).retry).toBe("render");
    }
    expect(retryFor({ reason: "storage_error" }, "quote")).toBe("quote");
  });
  it("a failed repeat keeps the stored image and does not pay by itself", () => {
    const f = act(generating(result(), "rerender"), { type: "render_failed", failure: { reason: "provider_error" } });
    expect(f.image).not.toBeNull();
    expect(f.retry).toBe("rerender");
  });
});

describe("reducer: a lost answer", () => {
  it("is recognised only on a paying request's network or unreadable answer", () => {
    expect(isLostAnswer({ reason: "network", sentAt: 1 })).toBe(true);
    expect(isLostAnswer({ reason: "bad_response", sentAt: 1 })).toBe(true);
    expect(isLostAnswer({ reason: "network" })).toBe(false);
    expect(isLostAnswer({ reason: "provider_error", sentAt: 1 })).toBe(false);
  });
  it("becomes pending, not failed, and offers nothing to press", () => {
    const p = pending();
    expect(p).toMatchObject({ phase: "pending", pendingSince: 5000, failure: null, retry: null });
    expect(mayPress(p, "render")).toBe(false);
    expect(mayPress(p, "rerender")).toBe(false);
    expect(act(p, { type: "press", mode: "render" })).toBe(p);
    expect(act(p, { type: "retry" })).toBe(p);
  });
  it("a typed server error is not a lost answer", () => {
    for (const reason of ["provider_error", "provider_timeout", "provider_refused", "storage_error", "budget_reached"] as const) {
      expect(act(generating(), { type: "render_failed", failure: { reason, sentAt: 5000 } }).phase).toBe("failed");
    }
  });
  it("a quote inside the window that is not cached keeps it pending, with no button", () => {
    const q = quoted(pending(), quote({ monthSpendUsd: 0.8 }));
    expect(q.phase).toBe("pending");
    expect(mayPress(q, "render")).toBe(false);
  });
  it("a quote that shows the image ends the window with a fresh result", () => {
    const r = quoted(pending(), quote(), img());
    expect(r).toMatchObject({ phase: "result", pendingSince: null, fresh: true, warnLost: false });
  });
  it("a failed background quote inside the window changes nothing", () => {
    const p = pending();
    expect(quoteFailed(p, { reason: "network" }, true).phase).toBe("pending");
    expect(quoteFailed(p, { reason: "network" }).phase).toBe("pending");
  });
  it("when the window ends with no image the ready state returns with the warning", () => {
    const r = act(quoted(pending(), quote()), { type: "pending_over" });
    expect(r).toMatchObject({ phase: "ready", warnLost: true, pendingSince: null });
    expect(mayPress(r, "render")).toBe(true);
    // and the warning ends with the next press
    expect(act(r, { type: "press", mode: "render" }).warnLost).toBe(false);
  });
  it("a reopen inside the window is pending (no quote yet), and ends in quoting if no quote ever arrived", () => {
    const o = act(INITIAL, { type: "open_pending", mode: "render", sentAt: 5000 });
    expect(o).toMatchObject({ phase: "pending", quote: null });
    expect(mayPress(o, "render")).toBe(false);
    expect(act(o, { type: "pending_over" })).toMatchObject({ phase: "quoting", warnLost: true });
    // the warning survives the quote that follows
    const after = quoted(act(o, { type: "pending_over" }), quote());
    expect(after).toMatchObject({ phase: "ready", warnLost: true });
  });
  it("a lost repeat keeps the old image and ends back on the result with the warning", () => {
    const p = act(generating(result(), "rerender"), { type: "render_failed", failure: lost() });
    expect(p.phase).toBe("pending");
    // the old picture is "cached" all along: it does not end the window
    expect(quoted(p, quote(), img(9000)).phase).toBe("pending");
    expect(act(p, { type: "pending_over" })).toMatchObject({ phase: "result", warnLost: true });
  });
  it("counts the window from the moment the request was sent", () => {
    expect(pendingLeftMs(5000, 5000)).toBe(PENDING_WINDOW_S * 1000);
    expect(pendingLeftMs(5000, 5000 + 119_000)).toBe(1000);
    expect(pendingLeftMs(5000, 5000 + 130_000)).toBe(0);
  });
});

describe("reducer: stale and failed background quotes", () => {
  it("a failed follow-up quote after a render shows nothing", () => {
    const r = act(generating(), { type: "render_ok", image: img(), monthSpendUsd: 0.9, budgetUsd: 8 });
    const after = quoteFailed(r, { reason: "network" }, true);
    expect(after.phase).toBe("result");
    expect(after.failure).toBeNull();
  });
  it("a quote that answers after a newer event is dropped", () => {
    const r = result();
    const started = act(r, { type: "quote_start" });
    // a press happens before the quote answers
    const g = act(started, { type: "press", mode: "rerender" });
    expect(act(g, { type: "quote_ok", ticket: started.seq, quote: quote(), image: img(2) })).toBe(g);
    // and the repeat fails, then the slow quote arrives: the error line stays
    const failed = act(g, { type: "render_failed", failure: { reason: "provider_error" } });
    expect(act(failed, { type: "quote_ok", ticket: started.seq, quote: quote(), image: img(2) })).toBe(failed);
    expect(act(failed, { type: "quote_failed", ticket: started.seq, failure: { reason: "network" } })).toBe(failed);
  });
  it("only the latest of two quotes is accepted", () => {
    const first = act(INITIAL, { type: "quote_start" });
    const second = act(first, { type: "quote_start" });
    expect(act(second, { type: "quote_ok", ticket: first.seq, quote: quote(), image: null })).toBe(second);
    expect(act(second, { type: "quote_ok", ticket: second.seq, quote: quote(), image: null }).phase).toBe("ready");
  });
  it("opening (or the outfit changing under an open sheet) drops what was shown and what was in flight", () => {
    const shown = result();
    const started = act(shown, { type: "quote_start" });
    const reopened = act(started, { type: "open" });
    expect(reopened).toMatchObject({ phase: "quoting", quote: null, image: null });
    expect(act(reopened, { type: "quote_ok", ticket: started.seq, quote: quote(), image: img() })).toBe(reopened);
  });
});

describe("reducer: an image that will not load", () => {
  it("asks quote again once, then reports it even when the new quote carries an image", () => {
    const a = act(result(), { type: "image_stale" });
    expect(a.phase).toBe("quoting");
    const b = act(quoted(a, quote(), img(2000)), { type: "image_stale" });
    expect(b).toMatchObject({ phase: "failed", retry: "quote", failure: { reason: "image_load" } });
  });
  it("two failures in a row without a good quote in between end in an error with a free retry", () => {
    const a = act(result(), { type: "image_stale" });
    const b = act({ ...a, phase: "result" }, { type: "image_stale" });
    expect(b).toMatchObject({ phase: "failed", retry: "quote", failure: { reason: "image_load" } });
  });
});

describe("helpers", () => {
  it("shrinks the picture on a short window", () => {
    expect(imageMaxWidth(640, 260)).toBeLessThan(imageMaxWidth(844, 260));
    expect(imageMaxWidth(100, 260)).toBe(160);
  });
  it("flight key ignores order", () => {
    const a = { item_id: id(1), slot: "top" as const };
    const b = { item_id: id(2), slot: "bottom" as const };
    expect(flightKey([a, b])).toBe(flightKey([b, a]));
  });
  it("single flight shares one running request and clears it after", async () => {
    const m = new Map<string, Promise<number>>();
    let n = 0;
    let done: (v: number) => void = () => undefined;
    const start = () =>
      new Promise<number>((r) => {
        n += 1;
        done = r;
      });
    const p1 = singleFlight(m, "k", start);
    const p2 = singleFlight(m, "k", start);
    expect(p1).toBe(p2);
    expect(n).toBe(1);
    done(7);
    expect(await p1).toBe(7);
    await Promise.resolve();
    expect(m.size).toBe(0);
  });
  it("gives up on a request with no answer", async () => {
    vi.useFakeTimers();
    const never = new Promise<string>(() => undefined);
    const p = withTimeout(never, 100_000, () => "lost");
    await vi.advanceTimersByTimeAsync(100_000);
    expect(await p).toBe("lost");
    const quick = withTimeout(Promise.resolve("ok"), 100_000, () => "lost");
    expect(await quick).toBe("ok");
    vi.useRealTimers();
  });
});
