import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { injectSiteHead, siteHeadTags, writeSiteHead } from "./site-head.mjs";

const TAGS = siteHeadTags({ name: "Fit Check", description: 'A "wardrobe" & outfits', verification: "abc" });

describe("siteHeadTags", () => {
  it("title, description and the Search Console tag, escaped", () => {
    expect(TAGS).toBe(
      '<title>Fit Check</title><meta name="description" content="A &quot;wardrobe&quot; &amp; outfits"/>' +
        '<meta name="google-site-verification" content="abc"/>',
    );
  });
});

describe("injectSiteHead", () => {
  const page = '<!DOCTYPE html><html lang="en"><head><meta charSet="utf-8"/></head><body></body></html>';

  it("goes right after <head>, once", () => {
    const once = injectSiteHead(page, TAGS);
    expect(once).toBe(page.replace("<head>", `<head>${TAGS}`));
    expect(injectSiteHead(once, TAGS)).toBe(once);
  });

  it("leaves a page with its own title alone, and refuses a page without <head>", () => {
    const titled = page.replace("<head>", "<head><title>Other</title>");
    expect(injectSiteHead(titled, TAGS)).toBe(titled);
    expect(() => injectSiteHead("<html><body></body></html>", TAGS)).toThrow(/no <head>/);
  });
});

describe("writeSiteHead", () => {
  it("every .html page under the export, nested ones too; an empty export fails", () => {
    const dir = mkdtempSync(join(tmpdir(), "site-head-"));
    mkdirSync(join(dir, "join"));
    writeFileSync(join(dir, "index.html"), "<html><head></head></html>");
    writeFileSync(join(dir, "join", "[code].html"), "<html><head></head></html>");
    writeFileSync(join(dir, "app.js"), "<head>");
    expect(writeSiteHead(dir, TAGS)).toBe(2);
    expect(readFileSync(join(dir, "join", "[code].html"), "utf8")).toContain("<title>Fit Check</title>");
    expect(readFileSync(join(dir, "app.js"), "utf8")).toBe("<head>");
    expect(() => writeSiteHead(mkdtempSync(join(tmpdir(), "site-head-empty-")), TAGS)).toThrow(/no .html page/);
  });
});
