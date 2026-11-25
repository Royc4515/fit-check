// @ts-check
/**
 * Writes the page title, description and Google Search Console tag into every pre-rendered web page, right after
 * `expo export` (Vercel's build command). Google's brand verification reads them without running the app.
 *
 * Why a step after the export and not in the app:
 * - a custom `src/app/+html.tsx` stopped the export from linking the app's scripts and styles (blank page, Expo SDK 55);
 * - expo-router's `Head` renders only inside a focused screen, and the pre-rendered HTML never reaches one (the root
 *   layout renders a quiet placeholder until it is mounted on the client).
 *
 * Usage: `node scripts/site-head.mjs dist`. Fails the build when it finds no page or a page without `<head>`, so a
 * change in Expo's output cannot silently drop the tags.
 */
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/**
 * Google Search Console's proof that the owner controls https://fit-check-il.vercel.app/ (the "HTML tag" method,
 * property added by Roy 2026-11-25). Public by design: it only proves ownership.
 * don't touch / Google re-checks the tag after verifying: removing or changing it un-verifies the property, and with
 * it the domain Google's brand verification (the app's name and logo on the sign-in screen) depends on.
 */
export const GOOGLE_SITE_VERIFICATION = "YzDkhTkRgboS7qGzVpaMq6ft7lxDWGqyvOzNzucqbmA";

/** @param {string} text */
const escapeHtml = (text) =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/**
 * The tags, in English for every visitor: the static HTML is one file per path, and Google's reviewers read it. Pure.
 * @param {{ name: string; description: string; verification: string }} site
 * @returns {string}
 */
export function siteHeadTags({ name, description, verification }) {
  return (
    `<title>${escapeHtml(name)}</title>` +
    `<meta name="description" content="${escapeHtml(description)}"/>` +
    `<meta name="google-site-verification" content="${escapeHtml(verification)}"/>`
  );
}

/**
 * Puts the tags right after `<head>`. A page that already has a title (a later screen may set its own) or the tag
 * is left as it is, so running twice changes nothing. Pure. Throws on a page without `<head>`.
 * @param {string} html
 * @param {string} tags
 * @returns {string}
 */
export function injectSiteHead(html, tags) {
  if (/<title[\s>]/i.test(html) || html.includes('name="google-site-verification"')) return html;
  const head = html.indexOf("<head>");
  if (head === -1) throw new Error("site-head: a page has no <head>; Expo's export output changed");
  const at = head + "<head>".length;
  return html.slice(0, at) + tags + html.slice(at);
}

/**
 * Every .html file under a directory, recursively.
 * @param {string} dir
 * @returns {string[]}
 */
function htmlFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return htmlFiles(path);
    return entry.isFile() && entry.name.endsWith(".html") ? [path] : [];
  });
}

/**
 * Writes the tags into every page under `dir` and returns how many pages it read. Throws when there is none.
 * @param {string} dir
 * @param {string} tags
 * @returns {number}
 */
export function writeSiteHead(dir, tags) {
  const pages = htmlFiles(dir);
  if (pages.length === 0) throw new Error(`site-head: no .html page under ${dir}`);
  for (const page of pages) writeFileSync(page, injectSiteHead(readFileSync(page, "utf8"), tags));
  return pages.length;
}

const isMain = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const dir = process.argv[2];
  if (!dir) throw new Error("usage: node scripts/site-head.mjs <export dir>");
  const here = dirname(fileURLToPath(import.meta.url));
  const en = JSON.parse(readFileSync(join(here, "..", "locales", "en.json"), "utf8"));
  const tags = siteHeadTags({ name: en.app.name, description: en.site.description, verification: GOOGLE_SITE_VERIFICATION });
  const count = writeSiteHead(dir, tags);
  console.log(`site-head: ${count} pages`);
}
