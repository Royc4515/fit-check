import type { Item, Subcategory } from "@fit-check/schema";

/** One filter dimension. Selection is single-value per facet; facets combine with AND. */
export const FACETS = ["type", "season", "color", "availability"] as const;
export type Facet = (typeof FACETS)[number];
export type Selection = Partial<Record<Facet, string>>;

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
  }
}

/**
 * Values present in the data, per facet, most frequent first. A facet with fewer than two values is dropped:
 * a chip that cannot change the result is noise (today every fixture item is `home`).
 */
export function deriveFacets(items: Item[]): Array<{ facet: Facet; values: string[] }> {
  return FACETS.map((facet) => {
    const counts = new Map<string, number>();
    for (const item of items) for (const v of valuesOf(item, facet)) counts.set(v, (counts.get(v) ?? 0) + 1);
    // Types keep their reading order (shirts before trousers before shoes); other facets go most frequent first.
    const values =
      facet === "type"
        ? TYPE_ORDER.filter((v) => counts.has(v))
        : [...counts.entries()]
            // Tie-break on the value so the chip order never depends on input order.
            .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
            .map(([v]) => v);
    return { facet, values };
  }).filter((f) => f.values.length >= 2);
}

/** Only `active` items belong in the wardrobe; `virtual` (pre-purchase) and `archived` never show. */
export function applyFilters(items: Item[], selection: Selection): Item[] {
  return items.filter(
    (item) =>
      item.status === "active" &&
      FACETS.every((facet) => {
        const wanted = selection[facet];
        return wanted === undefined || valuesOf(item, facet).includes(wanted);
      })
  );
}

/** Groups in CATEGORY_ORDER, items by name, empty groups omitted. */
export function groupByCategory(items: Item[]): Array<{ category: (typeof CATEGORY_ORDER)[number]; items: Item[] }> {
  return CATEGORY_ORDER.map((category) => ({
    category,
    items: items.filter((i) => i.tags.category === category).sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id)),
  })).filter((g) => g.items.length > 0);
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
