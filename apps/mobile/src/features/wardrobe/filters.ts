import { DEFAULT_CONTEXT_RULES, passesContextRules } from "@fit-check/engine";
import type { Item, Subcategory } from "@fit-check/schema";
import { COLOR_HEX } from "../intake/palette";

/** One filter dimension. Selection is single-value per facet; facets combine with AND. */
export const FACETS = ["type", "season", "color", "availability", "context", "formality"] as const;
export type Facet = (typeof FACETS)[number];
export type Selection = Partial<Record<Facet, string>>;

/**
 * The facets that live in the filter sheet, in row order; colour has its own row of swatches on the screen. The
 * stage 2 rows (context, formality; DESIGN.md "שלב 2: תוספות") come after the original three.
 */
export const SHEET_FACETS = ["type", "season", "availability", "context", "formality"] as const satisfies readonly Facet[];
export type SheetFacet = (typeof SHEET_FACETS)[number];

/**
 * Formality bands for the "רשמיות" row (DESIGN.md "שלב 2"): casual 1-4, in between 5-7, formal 8-10. Upper bounds,
 * in reading order.
 */
export const FORMALITY_BANDS = [
  { band: "casual", max: 4 },
  { band: "mid", max: 7 },
  { band: "formal", max: 10 },
] as const;
export type FormalityBand = (typeof FORMALITY_BANDS)[number]["band"];
const FORMALITY_ORDER: readonly string[] = FORMALITY_BANDS.map((b) => b.band);

/** The band of a 1-10 formality score. */
export function formalityBand(formality: number): FormalityBand {
  return FORMALITY_BANDS.find((b) => formality <= b.max)?.band ?? "formal";
}

/**
 * "לשבת": the item passes the engine's own Shabbat rules for its slot, the same check hardFilter makes before the
 * stylist sees anything, so the chip and the suggestions never disagree. Weather and availability are not part of
 * it (the availability row filters those); outerwear and accessories have no rules there and pass.
 */
export function fitsShabbat(item: Item): boolean {
  return passesContextRules(item, DEFAULT_CONTEXT_RULES.shabbat);
}

/**
 * Garment types for the type filter (Roy, 2026-11-10: shirts, T-shirts and overshirts apart). Coarser than the 19
 * subcategories so the row stays short: jeans, chinos and trousers are one "trousers" chip. Listed in reading order.
 */
export const TYPE_OF: Record<Subcategory, string> = {
  button_down: "shirts",
  tshirt: "tshirts",
  polo: "polos",
  overshirt: "overshirts",
  knit: "knitwear",
  sweatshirt: "knitwear",
  jeans: "trousers",
  chinos: "trousers",
  trousers: "trousers",
  shorts: "shorts",
  sneakers: "shoes",
  boots: "shoes",
  dress_shoes: "shoes",
  sandals: "shoes",
  coat: "outerwear",
  jacket: "outerwear",
  belt: "accessories",
  watch: "accessories",
  hat: "accessories",
};
const TYPE_ORDER = [...new Set(Object.values(TYPE_OF))];

/** Category order is fixed: it is the reading order of the wardrobe, not alphabetical. */
export const CATEGORY_ORDER = ["top", "bottom", "shoes", "layer", "outerwear", "accessory"] as const;
export type Category = (typeof CATEGORY_ORDER)[number];

/**
 * Order of the category tabs (DESIGN.md section 3 "ארון" item 2: shirts, trousers, layers, coats, shoes,
 * accessories), and of the groups under "all" on the wardrobe screen: the grid right under the tabs must read in
 * the same order, or "shoes" is the third heading under a row where it is the fifth word.
 */
export const CATEGORY_TABS: readonly Category[] = ["top", "bottom", "layer", "outerwear", "shoes", "accessory"];

/** "all" or one category: the screen's first filter, outside the facets. */
export type CategoryScope = "all" | Category;

function valuesOf(item: Item, facet: Facet): string[] {
  switch (facet) {
    case "type":
      return [TYPE_OF[item.tags.subcategory]];
    case "season":
      return item.tags.seasons;
    case "color":
      return [item.tags.color_name];
    case "availability":
      return [item.availability];
    case "context":
      return fitsShabbat(item) ? ["shabbat"] : [];
    case "formality":
      return [formalityBand(item.tags.formality)];
  }
}

/** Lowercased, NFKC (full-width Latin, presentation forms), whitespace trimmed and collapsed. Hebrew has no case. */
function normalize(s: string): string {
  return s.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * The wardrobe search (DESIGN.md "שלב 2", "חיפוש בארון"): a substring of the name or of the brand, any case, Hebrew
 * or Latin. An empty or all-space query matches everything.
 */
export function matchesQuery(item: Pick<Item, "name" | "brand">, query: string): boolean {
  const q = normalize(query);
  if (q === "") return true;
  return normalize(item.name).includes(q) || (item.brand !== null && normalize(item.brand).includes(q));
}

/** Only `active` items belong in the wardrobe; `virtual` (pre-purchase) and `archived` never show. */
export function listed(items: readonly Item[]): Item[] {
  return items.filter((i) => i.status === "active");
}

/** Categories that hold at least one listed item, in tab order. */
export function presentCategories(items: readonly Item[]): Category[] {
  const present = new Set(listed(items).map((i) => i.tags.category));
  return CATEGORY_TABS.filter((c) => present.has(c));
}

/** Listed items inside the category scope. */
export function inScope(items: readonly Item[], scope: CategoryScope): Item[] {
  return listed(items).filter((i) => scope === "all" || i.tags.category === scope);
}

/**
 * Values present in the data, per facet, most frequent first. A facet with fewer than two values is dropped:
 * a chip that cannot change the result is noise (today every fixture item is `home`). A value that is selected but
 * no longer present (the category changed under it) is kept at the end, so it can still be seen and cleared.
 */
export function deriveFacets<F extends Facet>(
  items: readonly Item[],
  facets: readonly F[],
  selection: Selection = {}
): { facet: F; values: string[] }[] {
  return facets
    .map((facet) => {
      const counts = new Map<string, number>();
      for (const item of items) for (const v of valuesOf(item, facet)) counts.set(v, (counts.get(v) ?? 0) + 1);
      // Types keep their reading order (shirts before trousers before shoes); other facets go most frequent first.
      const values =
        facet === "type"
          ? TYPE_ORDER.filter((v) => counts.has(v))
          : facet === "formality"
            ? FORMALITY_ORDER.filter((v) => counts.has(v))
            : [...counts.entries()]
                // Tie-break on the value so the chip order never depends on input order.
                .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
                .map(([v]) => v);
      // The context row is one chip: it earns its place when it narrows the set (some items pass, some do not).
      const narrows =
        facet === "context" ? values.length === 1 && (counts.get(values[0] ?? "") ?? 0) < items.length : values.length >= 2;
      const wanted = selection[facet];
      if (wanted !== undefined && !values.includes(wanted)) values.push(wanted);
      return { facet, values, narrows };
    })
    .filter((f) => f.narrows || selection[f.facet] !== undefined)
    .map(({ facet, values }) => ({ facet, values }));
}

/** Items matching every selected facet (AND across facets). `except` ignores one facet, e.g. for its own options. */
export function applyFilters(items: readonly Item[], selection: Selection, except?: Facet): Item[] {
  return items.filter((item) =>
    FACETS.every((facet) => {
      const wanted = facet === except ? undefined : selection[facet];
      return wanted === undefined || valuesOf(item, facet).includes(wanted);
    })
  );
}

/** Groups in `order` (CATEGORY_ORDER unless given), items by name, empty groups omitted. */
export function groupByCategory(items: Item[], order: readonly Category[] = CATEGORY_ORDER): { category: Category; items: Item[] }[] {
  return order.map((category) => ({
    category,
    items: items.filter((i) => i.tags.category === category).sort(byName),
  })).filter((g) => g.items.length > 0);
}

/** Name, then id: a stable order that never depends on how the rows came back from the database. */
export function byName(a: Item, b: Item): number {
  return a.name.localeCompare(b.name) || a.id.localeCompare(b.id);
}

/** Perceived lightness of a hex, 0-255. Only used to order the swatch row, so a quick weighting is enough. */
function lightness(hex: string): number {
  const n = parseInt(hex.replace("#", ""), 16);
  if (Number.isNaN(n)) return 0;
  return 0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255);
}

/**
 * The colours in a set of items, one swatch per colour name (the filter is by name), lightest first so the row
 * reads as the wardrobe's palette. The square shows the hex most of those garments actually have, falling back to
 * the canonical palette value. A selected colour that is not among them is kept, so it can be cleared.
 */
export function swatchesOf(items: readonly Item[], selected?: string): { name: string; hex: string }[] {
  const hexCounts = new Map<string, Map<string, number>>();
  for (const item of items) {
    const name = item.tags.color_name;
    const hex = item.tags.color_hex.toUpperCase();
    const byHex = hexCounts.get(name) ?? new Map<string, number>();
    byHex.set(hex, (byHex.get(hex) ?? 0) + 1);
    hexCounts.set(name, byHex);
  }
  const palette: Readonly<Record<string, string | undefined>> = COLOR_HEX;
  const out = [...hexCounts.entries()].flatMap(([name, byHex]) => {
    const top = [...byHex.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
    const hex = top?.[0] ?? palette[name];
    return hex ? [{ name, hex }] : [];
  });
  const kept = selected !== undefined && !hexCounts.has(selected) ? palette[selected] : undefined;
  if (selected !== undefined && kept) out.push({ name: selected, hex: kept });
  return out.sort((a, b) => lightness(b.hex) - lightness(a.hex) || a.name.localeCompare(b.name));
}

/**
 * What usually goes to reserve duty (Roy, 2026-11-08): T-shirts, sportswear, slides. The picker shows these first;
 * the rest of the wardrobe is one tap away. Uniform, army boots and pyjamas are not wardrobe items (not in the
 * tag schema) and appear as a reminder line instead.
 */
export function isReserveItem(item: Item): boolean {
  const { subcategory, style_tags } = item.tags;
  return subcategory === "tshirt" || subcategory === "sandals" || style_tags.includes("sport");
}
