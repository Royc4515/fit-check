import type { ItemTags } from "@fit-check/schema";
import type { TFunction } from "i18next";
import { describe, expect, it } from "vitest";
import { failureMessage, isRetryable } from "./failure";
import { hasSleeves, isBottom, legOf, normalizeTags, subcategoryForLeg } from "./tagRules";
import { uploadedLabel, type AgoKey } from "./uploadedLabel";

const tags: ItemTags = {
  category: "top",
  subcategory: "polo",
  color_name: "white",
  color_hex: "#F4F1EA",
  secondary_color_hex: null,
  pattern: "solid",
  material: "cotton",
  sleeve: "short",
  fit: "regular",
  seasons: ["summer"],
  formality: 3,
  temp_min_c: 18,
  temp_max_c: 32,
  modesty_flags: ["short_sleeve"],
  style_tags: [],
};
const as = (patch: Partial<ItemTags>): ItemTags => ({ ...tags, ...patch });

describe("normalizeTags: fields that follow from others", () => {
  it("derives the category from the subcategory", () => {
    expect(normalizeTags(as({ subcategory: "jeans", category: "top", sleeve: "na" })).category).toBe("bottom");
    expect(normalizeTags(as({ subcategory: "sneakers", category: "top", sleeve: "na" })).category).toBe("shoes");
    expect(normalizeTags(as({ subcategory: "knit", category: "top" })).category).toBe("layer");
  });

  it("a garment without sleeves gets sleeve 'na', whatever it had", () => {
    expect(normalizeTags(as({ subcategory: "chinos", sleeve: "long" })).sleeve).toBe("na");
    expect(normalizeTags(as({ subcategory: "belt", sleeve: "short" })).sleeve).toBe("na");
  });

  it("a garment that gains sleeves from 'na' defaults to short (Roy, 2026-11-10)", () => {
    const got = normalizeTags(as({ subcategory: "tshirt", sleeve: "na" }));
    expect(got.sleeve).toBe("short");
    expect(got.modesty_flags).toContain("short_sleeve");
  });

  it("keeps a chosen sleeve length", () => {
    expect(normalizeTags(as({ sleeve: "long", modesty_flags: [] })).sleeve).toBe("long");
  });

  it("long sleeves drop a stale short_sleeve flag; short and sleeveless add it", () => {
    expect(normalizeTags(as({ sleeve: "long", modesty_flags: ["short_sleeve"] })).modesty_flags).not.toContain("short_sleeve");
    expect(normalizeTags(as({ sleeve: "sleeveless", modesty_flags: [] })).modesty_flags).toContain("short_sleeve");
    expect(normalizeTags(as({ sleeve: "short", modesty_flags: [] })).modesty_flags).toContain("short_sleeve");
  });

  it("shorts add short_pants; any other garment drops it", () => {
    expect(normalizeTags(as({ subcategory: "shorts", sleeve: "na", modesty_flags: [] })).modesty_flags).toContain("short_pants");
    expect(normalizeTags(as({ subcategory: "chinos", sleeve: "na", modesty_flags: ["short_pants"] })).modesty_flags).not.toContain("short_pants");
  });

  it("leaves unrelated flags alone and never duplicates a flag", () => {
    const got = normalizeTags(as({ sleeve: "short", modesty_flags: ["short_sleeve", "open_front"] }));
    expect(got.modesty_flags.filter((f) => f === "short_sleeve")).toHaveLength(1);
    expect(got.modesty_flags).toContain("open_front");
  });

  it("is idempotent and does not change the other tags or the input", () => {
    const input = as({ subcategory: "jeans", category: "top", sleeve: "long", modesty_flags: ["short_sleeve"] });
    const copy = structuredClone(input);
    const once = normalizeTags(input);
    expect(normalizeTags(once)).toEqual(once);
    expect(input).toEqual(copy);
    expect(once.color_name).toBe("white");
    expect(once.formality).toBe(3);
  });
});

describe("sleeves and leg length", () => {
  it("sleeves exist for top, layer and outerwear only", () => {
    expect(hasSleeves(as({ category: "top" }))).toBe(true);
    expect(hasSleeves(as({ category: "layer" }))).toBe(true);
    expect(hasSleeves(as({ category: "outerwear" }))).toBe(true);
    for (const category of ["bottom", "shoes", "accessory"] as const) expect(hasSleeves(as({ category }))).toBe(false);
  });

  it("isBottom and legOf: shorts are short, every other bottom is long", () => {
    expect(isBottom(as({ category: "bottom" }))).toBe(true);
    expect(isBottom(as({ category: "top" }))).toBe(false);
    expect(legOf(as({ subcategory: "shorts" }))).toBe("short");
    expect(legOf(as({ subcategory: "jeans" }))).toBe("long");
  });

  it("choosing short always gives shorts", () => {
    expect(subcategoryForLeg("short", as({ subcategory: "jeans" }))).toBe("shorts");
    expect(subcategoryForLeg("short", as({ subcategory: "shorts" }), "jeans")).toBe("shorts");
  });

  it("choosing long keeps a long type the garment already has", () => {
    expect(subcategoryForLeg("long", as({ subcategory: "jeans" }), "trousers")).toBe("jeans");
  });

  it("going back to long restores the remembered long type, else chinos", () => {
    expect(subcategoryForLeg("long", as({ subcategory: "shorts" }), "jeans")).toBe("jeans");
    expect(subcategoryForLeg("long", as({ subcategory: "shorts" }))).toBe("chinos");
  });

  it("a remembered 'shorts' is not a long type", () => {
    expect(subcategoryForLeg("long", as({ subcategory: "shorts" }), "shorts")).toBe("chinos");
  });
});

/** A translator that echoes the key and options, and knows only the keys the file uses. */
const known = new Set(["intake.reason.network", "intake.reason.rate_limited", "intake.reason.unknown"]);
const t = ((key: string, opts?: { status?: string; defaultValue?: string }) => {
  if (opts?.status !== undefined) return `${key}|${opts.status}`;
  if (!known.has(key) && opts?.defaultValue !== undefined) return opts.defaultValue;
  return key;
}) as unknown as TFunction;

describe("failureMessage", () => {
  it("a design-preview block says what did not happen, per kind, generic by default", () => {
    expect(failureMessage(t, "preview", "upload")).toBe("intake.fail.preview.upload");
    expect(failureMessage(t, "preview", "save")).toBe("intake.fail.preview.save");
    expect(failureMessage(t, "preview")).toBe("intake.fail.preview.generic");
  });

  it("http_<status> names the status, wrapped as an isolated left-to-right run", () => {
    expect(failureMessage(t, "http_503")).toBe("intake.fail.http|⁦503⁩");
    expect(failureMessage(t, "http_404", "save")).toBe("intake.fail.http|⁦404⁩");
  });

  it("only a three-digit status counts: anything else is an ordinary reason", () => {
    for (const bad of ["http_50", "http_5000", "http_", "http_abc", "xhttp_500", "http_500x"]) {
      expect(failureMessage(t, bad), bad).toBe("intake.reason.unknown");
    }
  });

  it("a known reason maps to its line; an unknown or empty one to the generic line", () => {
    expect(failureMessage(t, "network")).toBe("intake.reason.network");
    expect(failureMessage(t, "something_new")).toBe("intake.reason.unknown");
    expect(failureMessage(t, "")).toBe("intake.reason.unknown");
  });
});

describe("isRetryable", () => {
  it("is false where trying again cannot change the answer", () => {
    for (const r of ["preview", "daily_limit", "monthly_limit", "too_large", "bad_input", "no_garments", "billing_required"]) {
      expect(isRetryable(r), r).toBe(false);
    }
  });
  it("is true for network trouble, rate limits, server errors and anything unknown", () => {
    for (const r of ["network", "rate_limited", "http_500", "ai_failed", "something_new", ""]) expect(isRetryable(r), r).toBe(true);
  });
});

describe("uploadedLabel", () => {
  const NOW = Date.UTC(2026, 5, 15, 12, 0, 0);
  const ago = (ms: number) => new Date(NOW - ms).toISOString();
  const keys = (k: AgoKey) => k;
  const MIN = 60_000;
  const HOUR = 60 * MIN;

  it("no time, or an unreadable one, leaves the caption out", () => {
    expect(uploadedLabel(null, NOW, "en", keys)).toBeNull();
    expect(uploadedLabel("", NOW, "en", keys)).toBeNull();
    expect(uploadedLabel("not a date", NOW, "en", keys)).toBeNull();
  });

  it("a clock a little behind the server's (a future time) reads as now, not 'in 1 minute'", () => {
    expect(uploadedLabel(ago(-5 * MIN), NOW, "en", keys)).toBe("now");
  });

  it("under a minute is now", () => {
    expect(uploadedLabel(ago(0), NOW, "en", keys)).toBe("now");
    expect(uploadedLabel(ago(MIN - 1), NOW, "en", keys)).toBe("now");
  });

  it("one minute and one or two hours use the written-out phrases (Intl is wrong for them in Hebrew)", () => {
    expect(uploadedLabel(ago(MIN), NOW, "he", keys)).toBe("intake.queue.ago.minuteOne");
    expect(uploadedLabel(ago(MIN + 59_000), NOW, "he", keys)).toBe("intake.queue.ago.minuteOne");
    expect(uploadedLabel(ago(HOUR), NOW, "he", keys)).toBe("intake.queue.ago.hourOne");
    expect(uploadedLabel(ago(2 * HOUR + 30 * MIN), NOW, "he", keys)).toBe("intake.queue.ago.hourTwo");
  });

  it("other counts come from Intl, in the active language", () => {
    expect(uploadedLabel(ago(5 * MIN), NOW, "en", keys)).toBe("5 minutes ago");
    expect(uploadedLabel(ago(59 * MIN), NOW, "en", keys)).toBe("59 minutes ago");
    expect(uploadedLabel(ago(3 * HOUR), NOW, "en", keys)).toBe("3 hours ago");
    expect(uploadedLabel(ago(23 * HOUR + 59 * MIN), NOW, "en", keys)).toBe("23 hours ago");
    expect(uploadedLabel(ago(3 * HOUR), NOW, "he", keys)).toBe(new Intl.RelativeTimeFormat("he", { numeric: "auto" }).format(-3, "hour"));
  });

  it("a day or more is a short date, without the year in the same year", () => {
    const at = Date.UTC(2026, 2, 3, 12, 0, 0);
    const expected = new Intl.DateTimeFormat("en", { day: "numeric", month: "short" }).format(at);
    expect(uploadedLabel(new Date(at).toISOString(), NOW, "en", keys)).toBe(expected);
    // Exactly 24 hours is already a date, not "24 hours ago".
    expect(uploadedLabel(ago(24 * HOUR), NOW, "en", keys)).toBe(new Intl.DateTimeFormat("en", { day: "numeric", month: "short" }).format(NOW - 24 * HOUR));
  });

  it("the year is added when it is not this year", () => {
    const at = Date.UTC(2025, 2, 3, 12, 0, 0);
    const label = uploadedLabel(new Date(at).toISOString(), NOW, "en", keys);
    expect(label).toBe(new Intl.DateTimeFormat("en", { day: "numeric", month: "short", year: "numeric" }).format(at));
    expect(label).toContain("2025");
  });
});
