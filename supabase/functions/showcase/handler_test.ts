import { ShowcaseResponseSchema } from "@fit-check/schema/showcase.ts";
import { handleShowcase, pickShowcase, type SavedLook } from "./handler.ts";

function assertEquals(actual: unknown, expected: unknown) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

const tags = (subcategory: string, category: string) => ({
  category,
  subcategory,
  color_hex: "#1F2A44",
  color_name: "navy",
  secondary_color_hex: null,
  pattern: "solid",
  material: "cotton",
  fit: "regular",
  sleeve: "na",
  formality: 5,
  seasons: ["transition"],
  temp_min_c: 10,
  temp_max_c: 25,
  modesty_flags: [],
  style_tags: [],
});
let n = 0;
const piece = (slot: string, subcategory: string, category: string, over: Partial<SavedLook["pieces"][number]["item"]> = {}) => ({
  slot,
  item: { id: `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`, status: "active", cutout_path: `u/${n}.png`, thumb_path: null, tags: tags(subcategory, category), ...over },
});
const look = (...pieces: SavedLook["pieces"]): SavedLook => ({ pieces });
const whole = () => look(piece("top", "button_down", "top"), piece("bottom", "chinos", "bottom"), piece("shoes", "sandals", "shoes"));

Deno.test("pickShowcase: the first whole look, a layer included", () => {
  const first = look(...whole().pieces, piece("layer", "knit", "layer"));
  const picked = pickShowcase([first, whole()]);
  assertEquals(picked?.map((p) => p.slot), ["top", "bottom", "shoes", "layer"]);
  assertEquals(picked?.[0]?.item.id, first.pieces[0]?.item.id);
});

Deno.test("pickShowcase: skips a look with an archived garment, no photo, bad tags, no shoes or a doubled slot", () => {
  const archived = look(piece("top", "button_down", "top", { status: "archived" }), piece("bottom", "chinos", "bottom"), piece("shoes", "sandals", "shoes"));
  const noPhoto = look(piece("top", "button_down", "top"), piece("bottom", "chinos", "bottom", { cutout_path: null }), piece("shoes", "sandals", "shoes"));
  const badTags = look(piece("top", "button_down", "top", { tags: { subcategory: "x" } }), piece("bottom", "chinos", "bottom"), piece("shoes", "sandals", "shoes"));
  const noShoes = look(piece("top", "button_down", "top"), piece("bottom", "chinos", "bottom"), piece("layer", "knit", "layer"));
  const doubled = look(piece("top", "button_down", "top"), piece("top", "tshirt", "top"), piece("bottom", "chinos", "bottom"), piece("shoes", "sandals", "shoes"));
  const fallback = whole();
  assertEquals(pickShowcase([archived, noPhoto, badTags, noShoes, doubled, fallback])?.[0]?.item.id, fallback.pieces[0]?.item.id);
  assertEquals(pickShowcase([archived, noPhoto]), null);
  assertEquals(pickShowcase([]), null);
});

Deno.test("handleShowcase: the look, or none, or error; public and cached only when it answered", async () => {
  const req = () => new Request("http://x/showcase", { method: "POST" });
  const ok = await handleShowcase(req(), { ownerId: "roy", savedLooks: () => Promise.resolve([whole()]) });
  const body = await ok.json();
  assertEquals(ShowcaseResponseSchema.safeParse(body).success, true);
  assertEquals(body.pieces.length, 3);
  assertEquals(ok.headers.get("cache-control"), "public, max-age=600");

  const noOwner = await handleShowcase(req(), { ownerId: null, savedLooks: () => Promise.reject(new Error("not called")) });
  assertEquals(await noOwner.json(), { ok: false, reason: "none" });
  const failed = await handleShowcase(req(), { ownerId: "roy", savedLooks: () => Promise.resolve(null) });
  assertEquals(await failed.json(), { ok: false, reason: "error" });
  assertEquals(failed.headers.get("cache-control"), null);
  const empty = await handleShowcase(req(), { ownerId: "roy", savedLooks: () => Promise.resolve([]) });
  assertEquals(await empty.json(), { ok: false, reason: "none" });
  assertEquals((await handleShowcase(new Request("http://x/showcase", { method: "DELETE" }), { ownerId: "roy", savedLooks: () => Promise.resolve([]) })).status, 405);
});
