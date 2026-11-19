import { describe, expect, it } from "vitest";
import {
  addressExpired,
  canGenerate,
  flightKey,
  formatUsd,
  imageMaxWidth,
  imageOf,
  INITIAL,
  leftUsd,
  mayPress,
  msUntilExpiry,
  priceLine,
  quoteOf,
  reduceTryOn,
  retryFor,
  singleFlight,
  tryonItemsOf,
  type Quote,
  type StoredImage,
  type TryOnState,
} from "./model";

const id = (n: number) => `00000000-0000-4000-8000-00000000000${n}`;
const quote = (over: Partial<Quote> = {}): Quote => ({ priceUsd: 0.055, includesFigure: false, monthSpendUsd: 0.8, budgetUsd: 8, ...over });
const img = (at = 1000): StoredImage => ({ url: "https://x.test/a.png", expiresInS: 600, at });
const ready = (q = quote()): TryOnState => reduceTryOn(INITIAL, { type: "quote_ok", quote: q, image: null });
const result = (): TryOnState => reduceTryOn(INITIAL, { type: "quote_ok", quote: quote(), image: img() });

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
  it("is the budget line when the rest does not cover one image", () => {
    expect(priceLine(quote({ monthSpendUsd: 7.99 }))).toEqual({ kind: "budget_reached" });
    expect(priceLine(quote({ monthSpendUsd: 9 }))).toEqual({ kind: "budget_reached" });
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
    expect(reduceTryOn(result(), { type: "open" })).toEqual(INITIAL);
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
    const s = reduceTryOn(INITIAL, { type: "quote_failed", failure: { reason: "preview" } });
    expect(s.phase).toBe("preview");
    expect(s.retry).toBeNull();
    expect(reduceTryOn(s, { type: "press", mode: "render" })).toBe(s);
  });
  it("a failed quote is retried with a quote", () => {
    const s = reduceTryOn(INITIAL, { type: "quote_failed", failure: { reason: "network" } });
    expect(s).toMatchObject({ phase: "failed", retry: "quote" });
    expect(reduceTryOn(s, { type: "retry" }).phase).toBe("quoting");
  });
  it("reopening while a request runs is generating, never a paying button", () => {
    const s = reduceTryOn(INITIAL, { type: "open_in_flight", mode: "render" });
    expect(s.phase).toBe("generating");
    expect(reduceTryOn(s, { type: "quote_ok", quote: quote(), image: null })).toBe(s);
    expect(mayPress(s, "render")).toBe(false);
  });
});

describe("reducer: the paying press cannot happen twice", () => {
  it("accepts the first press and rejects the second by identity", () => {
    const a = ready();
    const b = reduceTryOn(a, { type: "press", mode: "render" });
    expect(b.phase).toBe("generating");
    expect(reduceTryOn(b, { type: "press", mode: "render" })).toBe(b);
    expect(reduceTryOn(b, { type: "press", mode: "rerender" })).toBe(b);
  });
  it("rejects a press while quoting, failed without retry, or with the budget spent", () => {
    expect(reduceTryOn(INITIAL, { type: "press", mode: "render" })).toBe(INITIAL);
    const spent = ready(quote({ monthSpendUsd: 8 }));
    expect(reduceTryOn(spent, { type: "press", mode: "render" })).toBe(spent);
  });
  it("again is only from a result, render only from ready", () => {
    expect(reduceTryOn(ready(), { type: "press", mode: "rerender" }).phase).toBe("ready");
    expect(reduceTryOn(result(), { type: "press", mode: "render" }).phase).toBe("result");
    expect(reduceTryOn(result(), { type: "press", mode: "rerender" }).phase).toBe("generating");
  });
  it("a retry after a paid failure is one more guarded press", () => {
    const f = reduceTryOn(reduceTryOn(ready(), { type: "press", mode: "render" }), { type: "render_failed", failure: { reason: "provider_timeout" } });
    expect(f).toMatchObject({ phase: "failed", retry: "render" });
    const again = reduceTryOn(f, { type: "retry" });
    expect(again.phase).toBe("generating");
    expect(reduceTryOn(again, { type: "retry" })).toBe(again);
  });
  it("a late answer outside generating is ignored", () => {
    const s = ready();
    expect(reduceTryOn(s, { type: "render_ok", image: img(), monthSpendUsd: 1, budgetUsd: 8 })).toBe(s);
    expect(reduceTryOn(s, { type: "render_failed", failure: { reason: "provider_error" } })).toBe(s);
  });
});

describe("reducer: results and failures", () => {
  it("a render gives a result with the new balance, and the figure no longer in the price", () => {
    const g = reduceTryOn(ready(quote({ priceUsd: 0.102, includesFigure: true })), { type: "press", mode: "render" });
    const r = reduceTryOn(g, { type: "render_ok", image: img(), monthSpendUsd: 0.9, budgetUsd: 8 });
    expect(r.phase).toBe("result");
    expect(r.quote).toMatchObject({ monthSpendUsd: 0.9, includesFigure: false });
  });
  it("budget_reached and item_has_no_image have no retry", () => {
    for (const reason of ["budget_reached", "item_has_no_image", "item_not_found", "invalid_input", "unauthenticated"] as const) {
      const f = reduceTryOn(reduceTryOn(ready(), { type: "press", mode: "render" }), { type: "render_failed", failure: { reason } });
      expect(f.retry).toBeNull();
      expect(reduceTryOn(f, { type: "retry" })).toBe(f);
    }
  });
  it("an answer that never arrived is retried with the free quote, not with a second payment", () => {
    expect(retryFor({ reason: "network" }, "render")).toBe("quote");
    expect(retryFor({ reason: "bad_response" }, "rerender")).toBe("quote");
    expect(retryFor({ reason: "provider_error" }, "rerender")).toBe("rerender");
    expect(retryFor({ reason: "storage_error" }, "quote")).toBe("quote");
  });
  it("a failed repeat keeps the stored image and does not pay by itself", () => {
    const f = reduceTryOn(reduceTryOn(result(), { type: "press", mode: "rerender" }), { type: "render_failed", failure: { reason: "provider_refused" } });
    expect(f.image).not.toBeNull();
    expect(f.retry).toBe("rerender");
  });
});

describe("reducer: an image that will not load", () => {
  it("asks quote again once, then reports it even when the new quote carries an image", () => {
    const a = reduceTryOn(result(), { type: "image_stale" });
    expect(a.phase).toBe("quoting");
    const b = reduceTryOn(reduceTryOn(a, { type: "quote_ok", quote: quote(), image: img(2000) }), { type: "image_stale" });
    expect(b).toMatchObject({ phase: "failed", retry: "quote", failure: { reason: "image_load" } });
  });
  it("two failures in a row without a good quote in between end in an error with a free retry", () => {
    const a = reduceTryOn(result(), { type: "image_stale" });
    const b = reduceTryOn({ ...a, phase: "result" }, { type: "image_stale" });
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
    const start = () => new Promise<number>((r) => {
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
});
