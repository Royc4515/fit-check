/**
 * Converts the "Roy's Wardrobe Database" sheet export into engine-ready items.
 *
 * Usage:
 *   pnpm import:sheet                       # dry run: prints a summary, writes nothing
 *   pnpm import:sheet -- --write            # also writes packages/engine/__fixtures__/wardrobe.json
 *   pnpm import:sheet -- --csv path/to.csv  # another export
 *
 * Why a heuristic mapper and not the tagging model: the sheet has no photos, so there
 * is nothing for a vision model to look at. Everything below is derived from the
 * sheet's own words. When a photo is added later, `intake-tag` overwrites these tags.
 *
 * Failure modes: a row whose derived tags fail the zod schema is reported and skipped,
 * never silently coerced. Unknown colors fall back to "grey" and are listed in the summary.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ItemSchema,
  ItemTagsSchema,
  SUBCATEGORY_TO_CATEGORY,
  type Item,
  type ItemTags,
  type ColorName,
  type Season,
  type Subcategory,
  type StyleTag,
  type ModestyFlag,
} from "@fit-check/schema";

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const write = args.includes("--write");
const csvArg = args.indexOf("--csv");
const csvPath = resolve(here, csvArg >= 0 ? (args[csvArg + 1] ?? "") : "data/wardrobe.csv");
const fixturePath = resolve(here, "../packages/engine/__fixtures__/wardrobe.json");
const pairWeightsPath = resolve(here, "../packages/engine/__fixtures__/pair-weights.json");

// --- CSV parsing (tiny, handles quoted fields with commas) --------------------------

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') {
        inQuotes = false;
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (c !== "\r") {
      field += c;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((f) => f.trim() !== ""));
}

// --- Mapping tables ------------------------------------------------------------------

type SheetRow = {
  id: string;
  name: string;
  category: string;
  style: string;
  color: string;
  formality: number;
  season: string;
  notes: string;
};

const BRANDS = [
  "Tommy Hilfiger",
  "Gant",
  "Zara",
  "Gap",
  "Polo Ralph Lauren",
  "Nike",
  "American Eagle",
  "Timberland",
  "Kenneth Cole",
  "Levi's",
  "Mango",
  "MNG",
  "Fox",
  "Nautica",
  "Columbia",
  "The North Face",
  "Calvin Klein",
  "Reebok",
  "Adidas",
  "Puma",
  "Salomon",
  "Birkenstock",
  "Quechua",
  "Koton",
  "Wrangler",
  "Old Navy",
  "Champion",
  "Hugo Boss",
  "Abercrombie",
  "Vans",
  "Jordan",
  "O'Neill",
  "Casio",
  "Swatch",
  "Jack & Jones",
  "Max Moretti",
  "Golf",
  "Matchton",
  "Tushi",
  "Smiley World",
];

function extractBrand(name: string): string | null {
  const lower = name.toLowerCase();
  for (const b of BRANDS) {
    if (lower.includes(b.toLowerCase())) return b === "MNG" ? "Mango" : b;
  }
  return null;
}

/** Subcategory from the sheet's Category + name words. Order matters: specific first. */
function toSubcategory(r: SheetRow): Subcategory | null {
  const n = r.name.toLowerCase();
  const s = r.style.toLowerCase();
  switch (r.category) {
    case "Shoes":
      if (/derby|oxford|dress/.test(n)) return "dress_shoes";
      if (/boot|chelsea/.test(n)) return "boots";
      if (/sandal|slide|mule/.test(n)) return "sandals";
      return "sneakers";
    case "Pants":
      if (/pyjama|pajama/.test(n)) return null; // sleepwear is not styled
      if (/short/.test(n)) return "shorts";
      if (/jeans/.test(n)) return "jeans";
      if (/chino/.test(n)) return "chinos";
      return "trousers";
    case "Shirt":
      // "Polo" is both a garment and a brand: "Gant Polo" is a polo, "Polo Ralph Lauren"
      // and "Polo Denim Shirt" are brand names on other garments.
      if (/\bpolo\b/.test(n) && !/ralph lauren|shirt/.test(n)) return "polo";
      if (/t-shirt|tee\b|\bt\b|\bls\b|pro shirt|striped shirt/.test(n)) return "tshirt";
      return "button_down";
    case "Knit":
      return "knit";
    case "Sweatshirt":
      return "sweatshirt";
    case "Coat":
      if (/jacket/.test(n) || /rain|active|running/.test(s)) return "jacket";
      return "coat";
    case "Accessories":
      if (/belt/.test(n)) return "belt";
      if (/watch|g-shock/.test(n)) return "watch";
      if (/beanie|hat|cap/.test(n)) return "hat";
      return null;
    default:
      return null;
  }
}

const COLOR_MAP: Array<[RegExp, ColorName, string]> = [
  [/navy|midnight|dark wash/i, "navy", "#1F2A44"],
  [/light blue|sky/i, "light_blue", "#9DB9D8"],
  [/denim|medium blue|faded blue/i, "blue", "#4A6FA5"],
  [/blue/i, "blue", "#3B5B8C"],
  [/white/i, "white", "#F4F1EA"],
  [/black|charcoal/i, "black", "#1B1A17"],
  [/cream/i, "cream", "#EFE6D2"],
  [/beige|stone|khaki|camel|taupe|mocha/i, "beige", "#C9B99A"],
  [/brown/i, "brown", "#6B4A2B"],
  [/burgundy/i, "burgundy", "#6E1F2B"],
  [/olive/i, "olive", "#6B6B3A"],
  [/green|mint/i, "green", "#3F6B4A"],
  [/orange/i, "orange", "#D2691E"],
  [/mustard|yellow/i, "yellow", "#D4A827"],
  [/red/i, "red", "#A3282E"],
  [/pink/i, "pink", "#E3A7B0"],
  [/grey|gray/i, "grey", "#8A8780"],
];

const unknownColors = new Set<string>();

function toColor(raw: string): { color_name: ColorName; color_hex: string } {
  // Primary color is the first token before "/" so "White/Black" reads as white.
  const primary = raw.split("/")[0] ?? raw;
  for (const [re, name, hex] of COLOR_MAP) {
    if (re.test(primary)) return { color_name: name, color_hex: hex };
  }
  unknownColors.add(raw);
  return { color_name: "grey", color_hex: "#8A8780" };
}

function toSeasons(raw: string): Season[] {
  const r = raw.toLowerCase();
  const out = new Set<Season>();
  if (/all year|home|sport/.test(r)) return ["summer", "transition", "winter"];
  if (/summer/.test(r)) out.add("summer");
  if (/trans/.test(r)) out.add("transition");
  if (/winter|outdoor/.test(r)) out.add("winter");
  return out.size ? [...out] : ["summer", "transition", "winter"];
}

/** Israeli bands: summer-only above 24, winter-only below 18. Coarse by design; feedback tunes it. */
function toTempRange(seasons: Season[]): { temp_min_c: number; temp_max_c: number } {
  const s = new Set(seasons);
  if (s.size === 3) return { temp_min_c: 5, temp_max_c: 40 };
  const min = s.has("winter") ? 5 : s.has("transition") ? 14 : 22;
  const max = s.has("summer") ? 40 : s.has("transition") ? 26 : 19;
  return { temp_min_c: min, temp_max_c: max };
}

function toStyleTags(style: string): StyleTag[] {
  const s = style.toLowerCase();
  const out = new Set<StyleTag>();
  if (/preppy|college|golf|country/.test(s)) out.add("preppy");
  if (/smart|business|office|work|day event|evening|night/.test(s)) out.add("smart_casual");
  if (/street|skater|edgy|grunge|trendy|retro/.test(s)) out.add("streetwear");
  if (/outdoor|hiking|tactical|utility|rugged|workwear|nature/.test(s)) out.add("outdoor");
  if (/sport|athleisure|performance|running|gym/.test(s)) out.add("sport");
  if (/formal|shabbat/.test(s)) out.add("formal");
  if (/resort|summer chic|boho/.test(s)) out.add("resort");
  return [...out];
}

function toPattern(r: SheetRow): ItemTags["pattern"] {
  const t = `${r.name} ${r.style} ${r.notes}`.toLowerCase();
  if (/stripe|seersucker/.test(t)) return "stripes";
  if (/gingham|check|flannel/.test(t)) return "check";
  if (/print|graphic|smiley/.test(t)) return "print";
  if (/melange/.test(t)) return "melange";
  if (/denim|jeans/.test(t)) return "denim";
  return "solid";
}

function toMaterial(r: SheetRow): ItemTags["material"] {
  const t = `${r.name} ${r.notes} ${r.style}`.toLowerCase();
  if (/linen/.test(t)) return "linen";
  if (/denim|jeans/.test(t)) return "denim";
  if (/leather/.test(t)) return "leather";
  if (/suede/.test(t)) return "suede";
  if (/wool|sweater|knit/.test(t)) return "wool";
  if (/dri-fit|technical|fleece|performance|synthetic/.test(t)) return "synthetic";
  if (/cotton|oxford|t-shirt|chino/.test(t)) return "cotton";
  return "unknown";
}

function toSleeve(sub: Subcategory, name: string): ItemTags["sleeve"] {
  if (["tshirt", "polo"].includes(sub)) return /\bls\b|long sleeve/i.test(name) ? "long" : "short";
  if (["button_down", "knit", "sweatshirt"].includes(sub)) return "long";
  return "na";
}

function toModesty(sub: Subcategory, sleeve: ItemTags["sleeve"], style: string): ModestyFlag[] {
  const flags: ModestyFlag[] = [];
  if (sleeve === "short") flags.push("short_sleeve");
  if (sub === "shorts") flags.push("short_pants");
  if (/open|layering|overshirt/i.test(style)) flags.push("open_front");
  return flags;
}

// --- Pair weights from notes like "Match with belt 1201/1204." --------------------------

function extractPairs(r: SheetRow): Array<[string, string, number]> {
  const pairs: Array<[string, string, number]> = [];
  const m = r.notes.match(/belt\s+(\d{3,4}(?:\s*\/\s*\d{3,4})*)/i);
  if (m?.[1]) {
    for (const id of m[1].split("/").map((x) => x.trim())) pairs.push([r.id, id, 0.3]);
  }
  return pairs;
}

// --- Main ----------------------------------------------------------------------------

const raw = readFileSync(csvPath, "utf8");
const [header, ...lines] = parseCsv(raw);
if (!header || header[0] !== "ID") throw new Error(`unexpected header in ${csvPath}: ${header?.join(",")}`);

const rows: SheetRow[] = lines.map((l) => ({
  id: l[0] ?? "",
  name: l[1] ?? "",
  category: l[2] ?? "",
  style: l[3] ?? "",
  color: l[4] ?? "",
  formality: Number(l[5] ?? "0"),
  season: l[6] ?? "",
  notes: l[7] ?? "",
}));

const items: Item[] = [];
const skipped: Array<{ id: string; name: string; reason: string }> = [];
const pairWeights: Array<{ item_a: string; item_b: string; weight: number }> = [];

for (const r of rows) {
  const sub = toSubcategory(r);
  if (!sub) {
    skipped.push({ id: r.id, name: r.name, reason: "not a styled garment (sleepwear / unmapped accessory)" });
    continue;
  }
  const seasons = toSeasons(r.season);
  const sleeve = toSleeve(sub, r.name);
  const color = toColor(r.color);
  const tagsResult = ItemTagsSchema.safeParse({
    category: SUBCATEGORY_TO_CATEGORY[sub],
    subcategory: sub,
    ...color,
    secondary_color_hex: null,
    pattern: toPattern(r),
    material: toMaterial(r),
    fit: /slim/i.test(`${r.name} ${r.notes}`) ? "slim" : /loose|relaxed|oversized/i.test(r.notes) ? "relaxed" : "regular",
    sleeve,
    formality: Math.min(10, Math.max(1, r.formality)),
    seasons,
    ...toTempRange(seasons),
    modesty_flags: toModesty(sub, sleeve, r.style),
    style_tags: toStyleTags(r.style),
  } satisfies ItemTags);
  if (!tagsResult.success) {
    skipped.push({ id: r.id, name: r.name, reason: tagsResult.error.issues.map((i) => i.message).join("; ") });
    continue;
  }
  const item = ItemSchema.parse({
    id: r.id,
    name: r.name,
    brand: extractBrand(r.name),
    tags: tagsResult.data,
    status: "active",
    availability: "home",
    source: "sheet",
    price: null,
    currency: null,
    purchased_at: null,
    cutout_path: null,
    notes: r.notes || null,
  } satisfies Item);
  items.push(item);
  for (const [a, b, w] of extractPairs(r)) pairWeights.push({ item_a: a, item_b: b, weight: w });
}

// --- Summary -------------------------------------------------------------------------

const bySub = new Map<string, number>();
for (const it of items) bySub.set(it.tags.subcategory, (bySub.get(it.tags.subcategory) ?? 0) + 1);

console.log(`rows: ${rows.length}, items: ${items.length}, skipped: ${skipped.length}, pair weights: ${pairWeights.length}`);
console.table([...bySub.entries()].sort((a, b) => b[1] - a[1]).map(([subcategory, count]) => ({ subcategory, count })));
if (skipped.length) console.table(skipped);
if (unknownColors.size) console.log("colors mapped to grey:", [...unknownColors].join(", "));

if (write) {
  mkdirSync(dirname(fixturePath), { recursive: true });
  writeFileSync(fixturePath, JSON.stringify(items, null, 2) + "\n");
  writeFileSync(pairWeightsPath, JSON.stringify(pairWeights, null, 2) + "\n");
  console.log(`wrote ${fixturePath}\nwrote ${pairWeightsPath}`);
} else {
  console.log("dry run; pass --write to produce the fixture");
}
