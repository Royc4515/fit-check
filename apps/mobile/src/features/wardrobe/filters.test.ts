import type { Item, ItemTags, Subcategory } from "@fit-check/schema";
import { SUBCATEGORY_TO_CATEGORY } from "@fit-check/schema";
import { describe, expect, it } from "vitest";
import {
  applyFilters,
  byName,
  CATEGORY_TABS,
  deriveFacets,
  FACETS,
  fitsShabbat,
  formalityBand,
  groupByCategory,
  inScope,
  isReserveItem,
  listed,
  matchesQuery,
  normalizeSearch,
  presentCategories,
  SHEET_FACETS,
  swatchesOf,
  TYPE_OF,
} from "./filters";

let seq = 0;
/** A valid item; the subcategory decides the category, so a test cannot build an item the schema would refuse. */
function make(over: { name?: string; brand?: string | null; sub?: Subcategory; status?: Item["status"]; availability?: Item["availability"]; tags?: Partial<ItemTags> } = {}): Item {
  seq += 1;
  const sub = over.sub ?? "tshirt";
  const tags: ItemTags = {
    category: SUBCATEGORY_TO_CATEGORY[sub],
    subcategory: sub,
    color_name: "white",
    color_hex: "#F4F1EA",
    secondary_color_hex: null,
    pattern: "solid",
    material: "cotton",
    sleeve: "short",
    fit: "regular",
    seasons: ["summer"],
    formality: 3,
    temp_min_c: 10,
    temp_max_c: 35,
    modesty_flags: [],
    style_tags: [],
    ...over.tags,
  };
  return {
    id: `i${seq}`,
    name: over.name ?? `Item ${seq}`,
    brand: over.brand === undefined ? null : over.brand,
    tags,
    status: over.status ?? "active",
    availability: over.availability ?? "home",
    source: "photo",
    price: null,
    currency: null,
    purchased_at: null,
    cutout_path: null,
    notes: null,
  };
}

describe("listed / inScope / presentCategories (category)", () => {
  it("keeps only active items: virtual and archived never show", () => {
    const a = make();
    const v = make({ status: "virtual" });
    const r = make({ status: "archived" });
    expect(listed([a, v, r])).toEqual([a]);
    expect(listed([])).toEqual([]);
  });

  it("inScope 'all' is every listed item; a category narrows to it", () => {
    const top = make({ sub: "button_down" });
    const shoe = make({ sub: "sneakers" });
    const gone = make({ sub: "button_down", status: "archived" });
    expect(inScope([top, shoe, gone], "all")).toEqual([top, shoe]);
    expect(inScope([top, shoe, gone], "top")).toEqual([top]);
    expect(inScope([top, shoe, gone], "layer")).toEqual([]);
  });

  it("presentCategories follows tab order, not input order, and ignores unlisted items", () => {
    const items = [make({ sub: "sneakers" }), make({ sub: "belt" }), make({ sub: "chinos" }), make({ sub: "coat", status: "archived" }), make({ sub: "polo" })];
    expect(presentCategories(items)).toEqual(["top", "bottom", "shoes", "accessory"]);
    expect(presentCategories([])).toEqual([]);
  });

  it("every category has a tab", () => {
    for (const sub of Object.keys(TYPE_OF) as Subcategory[]) expect(CATEGORY_TABS).toContain(SUBCATEGORY_TO_CATEGORY[sub]);
  });
});

describe("applyFilters: colour, season, availability, type, formality combine with AND", () => {
  const navyShirt = make({ sub: "button_down", tags: { color_name: "navy", seasons: ["winter", "transition"], formality: 8 } });
  const whiteTee = make({ sub: "tshirt", tags: { color_name: "white", seasons: ["summer"], formality: 2 } });
  const awayChinos = make({ sub: "chinos", availability: "away", tags: { color_name: "beige", seasons: ["summer", "winter"], formality: 6 } });
  const all = [navyShirt, whiteTee, awayChinos];

  it("an empty selection (the 'clear' state) returns everything, in order", () => {
    expect(applyFilters(all, {})).toEqual(all);
  });

  it("an explicitly undefined facet counts as not selected (what a toggle-off leaves behind)", () => {
    expect(applyFilters(all, { color: undefined, type: undefined })).toEqual(all);
  });

  it("filters by colour name", () => {
    expect(applyFilters(all, { color: "navy" })).toEqual([navyShirt]);
    expect(applyFilters(all, { color: "red" })).toEqual([]);
  });

  it("filters by season: an item with several seasons matches each of them", () => {
    expect(applyFilters(all, { season: "winter" })).toEqual([navyShirt, awayChinos]);
    expect(applyFilters(all, { season: "summer" })).toEqual([whiteTee, awayChinos]);
  });

  it("filters by availability", () => {
    expect(applyFilters(all, { availability: "away" })).toEqual([awayChinos]);
    expect(applyFilters(all, { availability: "home" })).toEqual([navyShirt, whiteTee]);
  });

  it("filters by garment type, which is coarser than the subcategory", () => {
    const jeans = make({ sub: "jeans" });
    const trousers = make({ sub: "trousers" });
    const knit = make({ sub: "knit" });
    const sweat = make({ sub: "sweatshirt" });
    expect(applyFilters([jeans, trousers, awayChinos, knit], { type: "trousers" })).toEqual([jeans, trousers, awayChinos]);
    expect(applyFilters([knit, sweat, whiteTee], { type: "knitwear" })).toEqual([knit, sweat]);
  });

  it("filters by formality band: 1-4 casual, 5-7 mid, 8-10 formal", () => {
    expect(applyFilters(all, { formality: "formal" })).toEqual([navyShirt]);
    expect(applyFilters(all, { formality: "casual" })).toEqual([whiteTee]);
    expect(applyFilters(all, { formality: "mid" })).toEqual([awayChinos]);
  });

  it("combines facets with AND", () => {
    expect(applyFilters(all, { season: "winter", availability: "home" })).toEqual([navyShirt]);
    expect(applyFilters(all, { season: "winter", color: "beige", availability: "away" })).toEqual([awayChinos]);
    expect(applyFilters(all, { color: "navy", availability: "away" })).toEqual([]);
  });

  it("`except` ignores one facet, for its own options, and only that one", () => {
    expect(applyFilters(all, { color: "navy", season: "summer" }, "color")).toEqual([whiteTee, awayChinos]);
    expect(applyFilters(all, { color: "navy", season: "summer" }, "season")).toEqual([navyShirt]);
  });

  it("does not mutate the input", () => {
    const copy = [...all];
    applyFilters(all, { color: "navy" });
    expect(all).toEqual(copy);
  });
});

describe("formalityBand", () => {
  it("cuts at 4 and 7", () => {
    expect([1, 4].map(formalityBand)).toEqual(["casual", "casual"]);
    expect([5, 7].map(formalityBand)).toEqual(["mid", "mid"]);
    expect([8, 10].map(formalityBand)).toEqual(["formal", "formal"]);
  });
  it("out-of-range scores land on the nearest band instead of throwing", () => {
    expect(formalityBand(0)).toBe("casual");
    expect(formalityBand(-3)).toBe("casual");
    expect(formalityBand(11)).toBe("formal");
  });
});

describe('"לשבת" (context facet, fitsShabbat)', () => {
  it("passes a slotted item only by the engine's rules: a white shirt yes, a print shirt or a T-shirt no", () => {
    expect(fitsShabbat(make({ sub: "button_down", tags: { formality: 8 } }))).toBe(true);
    expect(fitsShabbat(make({ sub: "button_down", tags: { formality: 8, pattern: "print" } }))).toBe(false);
    expect(fitsShabbat(make({ sub: "tshirt", tags: { formality: 8 } }))).toBe(false);
    expect(fitsShabbat(make({ sub: "jeans", tags: { formality: 8 } }))).toBe(false);
    expect(fitsShabbat(make({ sub: "dress_shoes", tags: { formality: 9 } }))).toBe(true);
    expect(fitsShabbat(make({ sub: "sneakers", tags: { formality: 9 } }))).toBe(false);
  });

  it("judges outerwear and accessories as layers: formality 6 and up passes, 5 does not", () => {
    for (const sub of ["coat", "jacket", "belt", "watch", "hat"] as const) {
      expect(fitsShabbat(make({ sub, tags: { formality: 6 } })), `${sub} at 6`).toBe(true);
      expect(fitsShabbat(make({ sub, tags: { formality: 10 } })), `${sub} at 10`).toBe(true);
      expect(fitsShabbat(make({ sub, tags: { formality: 5 } })), `${sub} at 5`).toBe(false);
    }
  });

  it("a puffer at formality 4 and a cap at 2 are not for Shabbat, although the engine lets them through", () => {
    expect(fitsShabbat(make({ sub: "jacket", tags: { formality: 4 } }))).toBe(false);
    expect(fitsShabbat(make({ sub: "hat", tags: { formality: 2 } }))).toBe(false);
  });

  it("a real layer (knit, overshirt) is judged on formality alone, not by the shirt whitelist", () => {
    expect(fitsShabbat(make({ sub: "knit", tags: { formality: 6 } }))).toBe(true);
    expect(fitsShabbat(make({ sub: "overshirt", tags: { formality: 5 } }))).toBe(false);
  });

  it("ignores availability and status: they belong to other filters", () => {
    expect(fitsShabbat(make({ sub: "button_down", availability: "away", status: "archived", tags: { formality: 8 } }))).toBe(true);
  });

  it("the context facet selects 'shabbat' items", () => {
    const yes = make({ sub: "button_down", tags: { formality: 8 } });
    const no = make({ sub: "tshirt" });
    expect(applyFilters([yes, no], { context: "shabbat" })).toEqual([yes]);
  });
});

describe("deriveFacets", () => {
  it("drops a facet that cannot change the result (fewer than two values)", () => {
    const items = [make({ sub: "tshirt" }), make({ sub: "tshirt" })];
    const got = deriveFacets(items, SHEET_FACETS).map((f) => f.facet);
    expect(got).not.toContain("type");
    expect(got).not.toContain("availability");
  });

  it("an empty list of items has no facets", () => {
    expect(deriveFacets([], SHEET_FACETS)).toEqual([]);
  });

  it("orders types by reading order, other facets by count, ties by value", () => {
    const items = [
      make({ sub: "sneakers", tags: { seasons: ["winter"] } }),
      make({ sub: "tshirt", tags: { seasons: ["summer"] } }),
      make({ sub: "tshirt", tags: { seasons: ["summer"] } }),
      make({ sub: "chinos", tags: { seasons: ["transition"] } }),
    ];
    const byFacet = Object.fromEntries(deriveFacets(items, SHEET_FACETS).map((f) => [f.facet, f.values]));
    expect(byFacet.type).toEqual(["tshirts", "trousers", "shoes"]);
    expect(byFacet.season).toEqual(["summer", "transition", "winter"]);
  });

  it("orders formality bands casual, mid, formal whatever the counts", () => {
    const items = [make({ tags: { formality: 9 } }), make({ tags: { formality: 9 } }), make({ tags: { formality: 2 } }), make({ tags: { formality: 6 } })];
    expect(deriveFacets(items, ["formality"])[0]?.values).toEqual(["casual", "mid", "formal"]);
  });

  it("offers the Shabbat chip only when it narrows the set", () => {
    const shirt = make({ sub: "button_down", tags: { formality: 8 } });
    const tee = make({ sub: "tshirt" });
    expect(deriveFacets([shirt, tee], ["context"])).toEqual([{ facet: "context", values: ["shabbat"] }]);
    expect(deriveFacets([shirt, shirt], ["context"])).toEqual([]);
    expect(deriveFacets([tee, tee], ["context"])).toEqual([]);
  });

  it("keeps a selected value that is no longer present, at the end, so it can be cleared", () => {
    const items = [make({ sub: "tshirt" }), make({ sub: "sneakers" })];
    const got = deriveFacets(items, ["type"], { type: "knitwear" });
    expect(got[0]?.values).toEqual(["tshirts", "shoes", "knitwear"]);
  });

  it("keeps a facet that has a selection even when it would otherwise be dropped", () => {
    const items = [make({ sub: "tshirt" }), make({ sub: "tshirt" })];
    expect(deriveFacets(items, ["type"], { type: "tshirts" })).toEqual([{ facet: "type", values: ["tshirts"] }]);
  });

  it("does not depend on input order", () => {
    const a = [make({ tags: { seasons: ["summer"] } }), make({ tags: { seasons: ["winter"] } })];
    expect(deriveFacets(a, ["season"])).toEqual(deriveFacets([...a].reverse(), ["season"]));
  });
});

describe("swatchesOf (colour)", () => {
  it("one swatch per colour name, lightest first", () => {
    const items = [
      make({ tags: { color_name: "black", color_hex: "#1B1A17" } }),
      make({ tags: { color_name: "white", color_hex: "#F4F1EA" } }),
      make({ tags: { color_name: "navy", color_hex: "#1F2A44" } }),
      make({ tags: { color_name: "white", color_hex: "#F4F1EA" } }),
    ];
    expect(swatchesOf(items).map((s) => s.name)).toEqual(["white", "navy", "black"]);
  });

  it("shows the hex most of those garments have, uppercased, ties by hex", () => {
    const items = [
      make({ tags: { color_name: "grey", color_hex: "#aaaaaa" } }),
      make({ tags: { color_name: "grey", color_hex: "#777777" } }),
      make({ tags: { color_name: "grey", color_hex: "#777777" } }),
    ];
    expect(swatchesOf(items)).toEqual([{ name: "grey", hex: "#777777" }]);
  });

  it("keeps a selected colour that is not among the items, with its palette hex, and ignores an unknown name", () => {
    const items = [make({ tags: { color_name: "white" } })];
    expect(swatchesOf(items, "navy").map((s) => s.name)).toContain("navy");
    expect(swatchesOf(items, "teal").map((s) => s.name)).toEqual(["white"]);
  });

  it("does not add the selected colour twice when it is present", () => {
    const items = [make({ tags: { color_name: "white" } })];
    expect(swatchesOf(items, "white")).toHaveLength(1);
  });

  it("is empty for no items", () => {
    expect(swatchesOf([])).toEqual([]);
  });
});

describe("search (matchesQuery, normalizeSearch)", () => {
  const polo = { name: "Ralph Lauren Polo", brand: "Ralph Lauren" };
  const hebrew = { name: "חולצת פולו כחולה", brand: null };

  it("an empty or all-space query matches everything, even an item with no brand", () => {
    expect(matchesQuery(polo, "")).toBe(true);
    expect(matchesQuery(polo, "   \t ")).toBe(true);
    expect(matchesQuery(hebrew, " ")).toBe(true);
  });

  it("matches a partial word anywhere in the name, any case", () => {
    expect(matchesQuery(polo, "polo")).toBe(true);
    expect(matchesQuery(polo, "LAUR")).toBe(true);
    expect(matchesQuery(polo, "h lau")).toBe(true);
    expect(matchesQuery(polo, "shirt")).toBe(false);
  });

  it("matches the brand even when the name does not carry it", () => {
    expect(matchesQuery({ name: "Chelsea Boots", brand: "Timberland" }, "timber")).toBe(true);
    expect(matchesQuery({ name: "Chelsea Boots", brand: null }, "timber")).toBe(false);
  });

  it("matches Hebrew by partial word", () => {
    expect(matchesQuery(hebrew, "פולו")).toBe(true);
    expect(matchesQuery(hebrew, "כחול")).toBe(true);
    expect(matchesQuery(hebrew, "ירוק")).toBe(false);
  });

  it("collapses repeated and edge whitespace on both sides", () => {
    expect(matchesQuery({ name: "Ralph   Lauren", brand: null }, "  ralph lauren ")).toBe(true);
  });

  it("folds accents, niqqud, geresh and curly quotes so what looks the same matches", () => {
    expect(matchesQuery({ name: "Café Racer", brand: null }, "cafe")).toBe(true);
    expect(matchesQuery({ name: "ÉCOLE", brand: null }, "ecole")).toBe(true);
    expect(matchesQuery({ name: "צ׳ינו", brand: null }, "צ'ינו")).toBe(true);
    expect(matchesQuery({ name: "ג״ינס", brand: null }, 'ג"ינס')).toBe(true);
    expect(matchesQuery({ name: "Levi's 501", brand: null }, "levi’s")).toBe(true);
    expect(matchesQuery({ name: "שָׁלוֹם", brand: null }, "שלום")).toBe(true);
  });

  it("full-width Latin letters match their plain forms", () => {
    expect(normalizeSearch("ＰＯＬＯ")).toBe("polo");
  });

  it("a query is never matched against the item's other fields", () => {
    expect(matchesQuery({ name: "Polo", brand: "Gant" }, "white")).toBe(false);
  });
});

describe("reserve duty: isReserveItem", () => {
  it("T-shirts, slides (sandals) and anything tagged sport go first", () => {
    expect(isReserveItem(make({ sub: "tshirt" }))).toBe(true);
    expect(isReserveItem(make({ sub: "sandals" }))).toBe(true);
    expect(isReserveItem(make({ sub: "sweatshirt", tags: { style_tags: ["sport"] } }))).toBe(true);
    expect(isReserveItem(make({ sub: "shorts", tags: { style_tags: ["smart_casual", "sport"] } }))).toBe(true);
  });

  it("dress clothes and plain casual items are not in the usual list", () => {
    expect(isReserveItem(make({ sub: "button_down", tags: { style_tags: ["formal"] } }))).toBe(false);
    expect(isReserveItem(make({ sub: "jeans" }))).toBe(false);
    expect(isReserveItem(make({ sub: "polo" }))).toBe(false);
  });

  it("the picker's usual list is the reserve items of the scope", () => {
    const tee = make({ sub: "tshirt" });
    const shirt = make({ sub: "button_down" });
    const gone = make({ sub: "tshirt", status: "archived" });
    expect(inScope([tee, shirt, gone], "all").filter(isReserveItem)).toEqual([tee]);
  });
});

describe("ordering: byName, groupByCategory", () => {
  it("byName orders by name, then id, so equal names never swap with the database order", () => {
    const a = { ...make({ name: "Same" }), id: "a" };
    const b = { ...make({ name: "Same" }), id: "b" };
    expect([b, a].sort(byName).map((i) => i.id)).toEqual(["a", "b"]);
    expect(byName(make({ name: "Apple" }), make({ name: "Banana" }))).toBeLessThan(0);
  });

  it("groups in category order, items by name, and omits empty groups", () => {
    const shoe = make({ sub: "sneakers", name: "B shoe" });
    const top2 = make({ sub: "polo", name: "Z polo" });
    const top1 = make({ sub: "tshirt", name: "A tee" });
    const groups = groupByCategory([shoe, top2, top1]);
    expect(groups.map((g) => g.category)).toEqual(["top", "shoes"]);
    expect(groups[0]?.items.map((i) => i.name)).toEqual(["A tee", "Z polo"]);
  });

  it("takes the order it is given, and does not reorder the caller's array", () => {
    const shoe = make({ sub: "sneakers" });
    const top = make({ sub: "polo" });
    const input = [shoe, top];
    expect(groupByCategory(input, ["shoes", "top"]).map((g) => g.category)).toEqual(["shoes", "top"]);
    expect(input).toEqual([shoe, top]);
    expect(groupByCategory([], undefined)).toEqual([]);
  });
});

describe("facet lists", () => {
  it("every sheet facet is a known facet", () => {
    for (const f of SHEET_FACETS) expect(FACETS).toContain(f);
  });
});
