import { describe, expect, it } from "vitest";
import { cutoutUrls, shownUri } from "./cutoutSource";

const supabaseUrl = (path: string) => `https://ref.supabase.co/storage/v1/object/public/cutouts/${path}`;
const R2 = "https://pub-x.r2.dev";
const KEY = "u1/intake/1794182849065-0/1-cutout.png";

describe("cutoutUrls", () => {
  it("uses Supabase alone when R2 is not configured", () => {
    expect(cutoutUrls(KEY, null, supabaseUrl)).toEqual({ primary: supabaseUrl(KEY), fallback: null });
  });

  it("tries R2 first and keeps Supabase as the fallback", () => {
    expect(cutoutUrls(KEY, R2, supabaseUrl)).toEqual({ primary: `${R2}/${KEY}`, fallback: supabaseUrl(KEY) });
  });

  it("does not double the slash when a key starts with one", () => {
    expect(cutoutUrls(`/${KEY}`, R2, supabaseUrl).primary).toBe(`${R2}/${KEY}`);
  });
});

describe("shownUri", () => {
  const urls = cutoutUrls(KEY, R2, supabaseUrl);

  it("shows the primary until it fails", () => {
    expect(shownUri(urls, null)).toBe(urls.primary);
  });

  it("switches to the fallback once the primary failed", () => {
    expect(shownUri(urls, urls.primary)).toBe(urls.fallback);
  });

  it("ignores a failure that belongs to another image (recycled view)", () => {
    expect(shownUri(urls, `${R2}/other.png`)).toBe(urls.primary);
  });

  it("stays on the only address when there is no fallback", () => {
    const only = cutoutUrls(KEY, null, supabaseUrl);
    expect(shownUri(only, only.primary)).toBe(only.primary);
  });
});
