import { describe, expect, it } from "vitest";
import { TryonErrorResponseSchema, TryonQuoteResponseSchema, TryonRenderResponseSchema, TryonRequestSchema, tryonCacheKeyInput } from "./index.ts";

const TOP = "11111111-1111-4111-8111-111111111111";
const BOTTOM = "22222222-2222-4222-8222-222222222222";
const SHOES = "33333333-3333-4333-8333-333333333333";
const LAYER = "44444444-4444-4444-8444-444444444444";
const outfit = [
  { item_id: TOP, slot: "top" },
  { item_id: BOTTOM, slot: "bottom" },
  { item_id: SHOES, slot: "shoes" },
] as const;

describe("TryonRequestSchema", () => {
  it("accepts three garments and an optional layer, in every mode", () => {
    for (const mode of ["quote", "render", "rerender"] as const) {
      expect(TryonRequestSchema.safeParse({ mode, items: outfit }).success).toBe(true);
      expect(TryonRequestSchema.safeParse({ mode, items: [...outfit, { item_id: LAYER, slot: "layer" }] }).success).toBe(true);
    }
  });

  it("rejects a missing top, bottom or shoes", () => {
    for (const drop of [0, 1, 2]) {
      const items = [...outfit.filter((_, i) => i !== drop), { item_id: LAYER, slot: "layer" }];
      expect(TryonRequestSchema.safeParse({ mode: "render", items }).success).toBe(false);
    }
  });

  it("rejects two tops, two layers, a duplicate id, more than four garments and an unknown mode", () => {
    const twoTops = [...outfit, { item_id: LAYER, slot: "top" }];
    const twoLayers = [outfit[0], outfit[1], { item_id: LAYER, slot: "layer" }, { item_id: SHOES, slot: "layer" }];
    const dup = [outfit[0], outfit[1], outfit[2], { item_id: TOP, slot: "layer" }];
    const five = [...outfit, { item_id: LAYER, slot: "layer" }, { item_id: "55555555-5555-4555-8555-555555555555", slot: "layer" }];
    for (const items of [twoTops, twoLayers, dup, five]) expect(TryonRequestSchema.safeParse({ mode: "render", items }).success).toBe(false);
    expect(TryonRequestSchema.safeParse({ mode: "draw", items: outfit }).success).toBe(false);
  });

  it("rejects ids that are not uuids and slots outside the outfit (outerwear, accessory)", () => {
    expect(TryonRequestSchema.safeParse({ mode: "render", items: [{ item_id: "401", slot: "top" }, outfit[1], outfit[2]] }).success).toBe(false);
    expect(TryonRequestSchema.safeParse({ mode: "render", items: [...outfit, { item_id: LAYER, slot: "outerwear" }] }).success).toBe(false);
  });
});

describe("tryonCacheKeyInput", () => {
  it("is the same for the same garments in any order", () => {
    const a = tryonCacheKeyInput("u1", [TOP, BOTTOM, SHOES, LAYER], "v1", "m");
    const b = tryonCacheKeyInput("u1", [LAYER, SHOES, TOP, BOTTOM], "v1", "m");
    expect(a).toBe(b);
  });

  it("changes with the user, a garment, the figure version and the model", () => {
    const base = tryonCacheKeyInput("u1", [TOP, BOTTOM, SHOES], "v1", "m");
    expect(tryonCacheKeyInput("u2", [TOP, BOTTOM, SHOES], "v1", "m")).not.toBe(base);
    expect(tryonCacheKeyInput("u1", [TOP, BOTTOM, LAYER], "v1", "m")).not.toBe(base);
    expect(tryonCacheKeyInput("u1", [TOP, BOTTOM, SHOES], "v2", "m")).not.toBe(base);
    expect(tryonCacheKeyInput("u1", [TOP, BOTTOM, SHOES], "v1", "m2")).not.toBe(base);
  });

  it("does not reorder the caller's array", () => {
    const ids = [SHOES, TOP];
    tryonCacheKeyInput("u1", ids, "v1", "m");
    expect(ids).toEqual([SHOES, TOP]);
  });
});

describe("responses", () => {
  it("parses each mode's success and the error shape", () => {
    expect(TryonQuoteResponseSchema.safeParse({ ok: true, mode: "quote", price_usd: 0.055, includes_figure: false, month_spend_usd: null, budget_usd: 8, cached: false }).success).toBe(true);
    expect(
      TryonRenderResponseSchema.safeParse({ ok: true, mode: "render", image_url: "https://x.supabase.co/storage/v1/object/sign/a", expires_in_s: 600, cached: true, cost_usd: 0, month_spend_usd: 1.2, budget_usd: 8 }).success,
    ).toBe(true);
    expect(TryonErrorResponseSchema.safeParse({ ok: false, error: "budget_reached", month_spend_usd: 7.99, budget_usd: 8 }).success).toBe(true);
    expect(TryonErrorResponseSchema.safeParse({ ok: false, error: "rate_limited" }).success).toBe(false);
  });
});
