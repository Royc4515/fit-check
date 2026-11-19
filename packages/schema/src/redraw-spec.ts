import { z } from "zod";
import { COLOR_NAMES, MATERIALS, PATTERNS, SLEEVES, SUBCATEGORIES, type ItemTags, type Subcategory } from "./item-tags.ts";

/**
 * The AI redraw composer's spec (Roy, 2026-11-18): what the paid image model is told about one garment, as tappable
 * words instead of a free prompt. The app shows it as running text plus chips; the Edge Function rebuilds the prompt
 * from it with buildRedrawPrompt, so the prompt the user previews is byte for byte the one that is sent.
 *
 * Three layers:
 * - garment: the item's own tags (closed lists). Changing a word here changes the tags, never the prompt alone.
 * - details / fixes: a closed vocabulary, Hebrew labels in the locale files, English fragments here.
 * - free: at most two short owner notes, for what the vocabulary cannot say.
 *
 * Not part of the frozen tag schema on purpose: details only steer a drawing, and the engine never reads them.
 */

type DetailDef = {
  /** English fragment that goes into the prompt. */
  en: string;
  /** Subcategories the detail is offered for; a detail outside them is rejected, so a hood never lands on jeans. */
  for: readonly Subcategory[];
  /** At most one detail per group: two collars, or a pleated flat front, would contradict each other in the prompt. */
  group?: string;
  /** Lower-case words in the item's name, brand or detection description that preselect this detail. */
  keywords: readonly string[];
};

const SHIRTS = ["button_down", "overshirt"] as const satisfies readonly Subcategory[];
const TOPS = ["button_down", "overshirt", "polo", "tshirt"] as const satisfies readonly Subcategory[];
const KNITS = ["knit", "sweatshirt"] as const satisfies readonly Subcategory[];
const OUTER = ["jacket", "coat"] as const satisfies readonly Subcategory[];
const LEGS = ["jeans", "chinos", "trousers"] as const satisfies readonly Subcategory[];
const SHOES = ["sneakers", "boots", "dress_shoes", "sandals"] as const satisfies readonly Subcategory[];

/**
 * The detail vocabulary. Order is the display order before history reorders it, so the most telling detail of each
 * garment type comes first. Adding an entry is safe (old specs stay valid); renaming or removing one breaks stored
 * specs, which are then dropped on read, so don't.
 */
export const REDRAW_DETAILS = {
  // Collars and necklines
  collar_button_down: { en: "button-down collar", for: SHIRTS, group: "collar", keywords: ["button-down", "button down", "oxford"] },
  collar_spread: { en: "spread collar", for: SHIRTS, group: "collar", keywords: ["spread", "cutaway"] },
  collar_mandarin: { en: "mandarin band collar with no collar points", for: [...TOPS], group: "collar", keywords: ["mandarin", "band collar", "grandad", "מנדרין"] },
  collar_camp: { en: "flat open camp collar", for: SHIRTS, group: "collar", keywords: ["camp collar", "cuban", "resort collar"] },
  collar_stand: { en: "stand-up collar", for: [...OUTER, "overshirt"], group: "collar", keywords: ["stand collar", "harrington"] },
  collar_lapel: { en: "notch lapels", for: OUTER, group: "collar", keywords: ["blazer", "lapel", "overcoat"] },
  collar_shearling: { en: "shearling collar", for: OUTER, group: "collar", keywords: ["sherpa", "shearling", "trucker"] },
  neck_crew: { en: "crew neck", for: ["tshirt", ...KNITS], group: "collar", keywords: ["crew"] },
  neck_v: { en: "V-neck", for: ["tshirt", ...KNITS], group: "collar", keywords: ["v-neck", "v neck"] },
  neck_henley: { en: "henley placket with buttons", for: ["tshirt", "knit"], group: "collar", keywords: ["henley"] },
  neck_turtle: { en: "roll neck", for: ["knit"], group: "collar", keywords: ["turtle", "roll neck", "mock neck", "גולף"] },
  neck_half_zip: { en: "half-zip stand collar", for: KNITS, group: "collar", keywords: ["half-zip", "half zip", "quarter zip", "1/4 zip", "חצי רוכסן"] },
  hood: { en: "hood", for: [...KNITS, ...OUTER, "overshirt"], group: "collar", keywords: ["hood", "hoodie", "קפוצ"] },

  // Fronts and closures
  full_zip: { en: "full-length front zip", for: [...OUTER, ...KNITS], group: "closure", keywords: ["full zip", "full-zip", "zip-up", "zip up", "zip jacket", "zip hoodie"] },
  buttons_front: { en: "buttoned front", for: [...OUTER, "knit", "overshirt"], group: "closure", keywords: ["cardigan", "button-up", "buttoned"] },
  snaps: { en: "snap buttons", for: ["overshirt", "jacket"], group: "closure", keywords: ["snap"] },
  double_breasted: { en: "double-breasted front", for: OUTER, group: "closure", keywords: ["double-breasted", "double breasted", "peacoat"] },

  // Pockets
  pocket_two: { en: "two flap chest pockets", for: SHIRTS, group: "chest_pocket", keywords: ["two pocket", "flap pocket", "utility", "military"] },
  pocket_one: { en: "one chest pocket", for: TOPS, group: "chest_pocket", keywords: ["pocket", "כיס"] },
  pocket_none: { en: "no chest pocket", for: TOPS, group: "chest_pocket", keywords: ["no pocket"] },
  kangaroo_pocket: { en: "kangaroo front pocket", for: ["sweatshirt"], keywords: ["kangaroo", "hoodie"] },
  side_pockets: { en: "two side pockets", for: [...OUTER, "overshirt"], keywords: ["side pocket"] },
  cargo_pockets: { en: "cargo pockets on the legs", for: ["trousers", "chinos", "shorts"], keywords: ["cargo"] },

  // Marks and texture
  logo_chest: {
    en: "small embroidered logo on the left chest",
    for: [...TOPS, ...KNITS, "jacket"],
    keywords: ["logo", "ralph lauren", "lacoste", "tommy", "gant", "לוגו"],
  },
  print_front: { en: "large graphic print on the front", for: ["tshirt", "sweatshirt"], keywords: ["graphic", "printed"] },
  cable_knit: { en: "cable-knit texture", for: ["knit"], keywords: ["cable"] },
  ribbed_trims: { en: "ribbed cuffs and hem", for: [...KNITS, "jacket"], keywords: ["ribbed", "bomber"] },
  quilted: { en: "quilted puffer panels", for: OUTER, keywords: ["puffer", "quilted", "down jacket"] },
  cuffs_button: { en: "buttoned barrel cuffs", for: SHIRTS, keywords: [] },

  // Trousers
  belt_loops: { en: "belt loops", for: [...LEGS, "shorts"], keywords: [] },
  pleats: { en: "front pleats", for: ["trousers", "chinos"], group: "front", keywords: ["pleat"] },
  flat_front: { en: "flat front with no pleats", for: ["trousers", "chinos"], group: "front", keywords: ["flat front"] },
  crease: { en: "pressed front crease", for: ["trousers"], keywords: ["tailored", "dress pants", "suit", "מחויט"] },
  drawstring: { en: "elastic drawstring waist", for: ["trousers", "chinos", "shorts"], keywords: ["drawstring", "jogger", "elastic"] },
  five_pocket: { en: "classic five-pocket design", for: ["jeans", "chinos"], keywords: ["5-pocket", "five pocket"] },
  turn_ups: { en: "turned-up hems", for: LEGS, keywords: ["turn-up", "turn up", "cuffed"] },
  leg_tapered: { en: "tapered leg", for: LEGS, group: "leg", keywords: ["tapered"] },
  leg_straight: { en: "straight leg", for: LEGS, group: "leg", keywords: ["straight"] },
  leg_wide: { en: "wide leg", for: LEGS, group: "leg", keywords: ["wide leg", "wide-leg"] },

  // Shoes
  laces: { en: "laces", for: ["sneakers", "boots", "dress_shoes"], group: "fastening", keywords: ["lace-up", "derby", "oxford shoe"] },
  slip_on: { en: "slip-on with no laces", for: ["sneakers", "boots", "dress_shoes"], group: "fastening", keywords: ["slip-on", "slip on", "loafer", "chelsea"] },
  sole_white: { en: "white rubber sole", for: SHOES, group: "sole", keywords: ["white sole"] },
  sole_gum: { en: "gum rubber sole", for: SHOES, group: "sole", keywords: ["gum"] },
  sole_dark: { en: "dark sole", for: SHOES, group: "sole", keywords: ["black sole", "dark sole"] },
  shoe_side_logo: { en: "logo on the side", for: ["sneakers"], keywords: ["nike", "adidas", "new balance", "veja", "puma"] },
  brogue: { en: "brogue perforations", for: ["dress_shoes", "boots"], keywords: ["brogue", "wingtip"] },
  shoe_pair: { en: "shown as a pair, one shoe in side profile and one at a three-quarter angle", for: SHOES, keywords: [] },

  // Accessories
  buckle_metal: { en: "metal buckle", for: ["belt"], keywords: ["buckle"] },
  strap_leather: { en: "leather strap", for: ["watch"], group: "strap", keywords: ["leather strap"] },
  strap_metal: { en: "metal bracelet", for: ["watch"], group: "strap", keywords: ["bracelet", "steel"] },
  cap_curved: { en: "baseball cap with a curved brim", for: ["hat"], keywords: ["cap"] },
} as const satisfies Record<string, DetailDef>;

export type RedrawDetailId = keyof typeof REDRAW_DETAILS;
// Object.keys loses the literal types; the satisfies above guarantees every key is a RedrawDetailId.
export const REDRAW_DETAIL_IDS = Object.keys(REDRAW_DETAILS) as [RedrawDetailId, ...RedrawDetailId[]];

/** Detail definition by id, typed as the common shape (the `as const` literal types differ per entry). */
export const detailDef = (id: RedrawDetailId): DetailDef => REDRAW_DETAILS[id];

/**
 * Corrections for what is wrong with the photo, not with the garment. Detection already reports these as issues,
 * so the composer preselects them for free (REDRAW_FIX_FOR_ISSUE).
 */
export const REDRAW_FIXES = {
  // don't touch / the reason redraws exist (2026-11-17: five cutouts still showed the shirt hanging behind).
  remove_behind: "Another garment is visible behind, under or next to it: remove it completely, only this garment may appear.",
  complete_hidden: "Part of it is hidden or cut off by the frame: draw the complete garment, both sleeves and the full hem or legs.",
  smooth_creases: "It is creased in the photo: render it pressed and smooth.",
  true_colour: "The photo is dark or tinted: render the true colour under neutral daylight.",
  sharp_texture: "The photo is blurry: render crisp fabric texture, seams and stitching.",
} as const;

export type RedrawFixId = keyof typeof REDRAW_FIXES;
export const REDRAW_FIX_IDS = Object.keys(REDRAW_FIXES) as [RedrawFixId, ...RedrawFixId[]];

/** Detection issue to the fix it calls for (GARMENT_ISSUES in intake.ts). */
export const REDRAW_FIX_FOR_ISSUE: Record<string, RedrawFixId> = {
  overlapping: "remove_behind",
  occluded: "complete_hidden",
  cut_off: "complete_hidden",
  wrinkled: "smooth_creases",
  dark: "true_colour",
  blurry: "sharp_texture",
};

/** More than this and the model starts dropping or mixing details; six covers every redraw done so far. */
export const MAX_REDRAW_DETAILS = 6;
/** Free notes are the escape hatch, not the interface (Roy, 2026-11-18: two at most). */
export const MAX_REDRAW_FREE = 2;
export const MAX_REDRAW_FREE_CHARS = 60;

/**
 * Cleans an owner note before it enters a prompt: no quotes, brackets or line breaks that could close the quoted
 * span and turn a note into an instruction, whitespace collapsed, capped. Hebrew stays as typed.
 */
export function cleanFreeText(text: string, max: number = MAX_REDRAW_FREE_CHARS): string {
  return (
    text
      // Apostrophes stay (Levi's, Hebrew geresh): only double quotes delimit a note in the prompt.
      // don't touch / \x escapes, not \u: a deploy transport that decodes \u in the mcp bundle turned \u000a into a raw newline inside this regex (2026-11-19).
      .replace(/[\x00-\x1f\x7f"“”„`\\<>{}[\]]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, max)
      .trim()
  );
}

export const REDRAW_FREE_KINDS = ["detail", "fix"] as const;
export const RedrawFreeSchema = z.object({
  kind: z.enum(REDRAW_FREE_KINDS),
  text: z.string().max(400).transform((t) => cleanFreeText(t)).pipe(z.string().min(2).max(MAX_REDRAW_FREE_CHARS)),
});
export type RedrawFree = z.infer<typeof RedrawFreeSchema>;

const hexColor = z.string().regex(/^#[0-9A-Fa-f]{6}$/, "expected #RRGGBB");

/** The garment words: a subset of ItemTags, copied in so a spec stands alone (the intake garment has no item yet). */
export const RedrawGarmentSchema = z.object({
  subcategory: z.enum(SUBCATEGORIES),
  color_name: z.enum(COLOR_NAMES),
  color_hex: hexColor,
  pattern: z.enum(PATTERNS),
  material: z.enum(MATERIALS),
  sleeve: z.enum(SLEEVES),
});
export type RedrawGarment = z.infer<typeof RedrawGarmentSchema>;

export const RedrawSpecSchema = z
  .object({
    v: z.literal(1),
    /** The name the user saw: it carries the brand and his own word for the cut ("Zara Mandarin Collar"). */
    name: z.string().trim().max(120).nullable(),
    garment: RedrawGarmentSchema,
    details: z.array(z.enum(REDRAW_DETAIL_IDS)).max(MAX_REDRAW_DETAILS),
    fixes: z.array(z.enum(REDRAW_FIX_IDS)).max(REDRAW_FIX_IDS.length),
    free: z.array(RedrawFreeSchema).max(MAX_REDRAW_FREE),
  })
  .superRefine((spec, ctx) => {
    const groups = new Set<string>();
    for (const id of spec.details) {
      const def = detailDef(id);
      if (!def.for.includes(spec.garment.subcategory)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["details"], message: `${id} does not apply to ${spec.garment.subcategory}` });
      }
      if (def.group && groups.has(def.group)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["details"], message: `two details in group ${def.group}` });
      }
      if (def.group) groups.add(def.group);
    }
    if (new Set(spec.details).size !== spec.details.length || new Set(spec.fixes).size !== spec.fixes.length) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "duplicate detail or fix" });
    }
  });
export type RedrawSpec = z.infer<typeof RedrawSpecSchema>;

/** The garment words of a tag set. */
export function garmentOf(tags: ItemTags): RedrawGarment {
  return {
    subcategory: tags.subcategory,
    color_name: tags.color_name,
    color_hex: tags.color_hex,
    pattern: tags.pattern,
    material: tags.material,
    sleeve: tags.sleeve,
  };
}

/**
 * The garment as one phrase. Same wording the app sent before the composer existed (describeForRedraw), so a spec
 * with no details or fixes draws exactly what an old redraw drew.
 */
export function describeRedrawGarment(spec: Pick<RedrawSpec, "name" | "garment">): string {
  const g = spec.garment;
  const pattern = g.pattern === "solid" ? "" : `${g.pattern} `;
  const material = g.material === "unknown" || g.material === "mixed" ? "" : `${g.material} `;
  const sleeve = g.sleeve === "na" ? "" : `, ${g.sleeve === "sleeveless" ? "sleeveless" : `${g.sleeve} sleeves`}`;
  const base = `${g.color_name.replace("_", " ")} ${pattern}${material}${g.subcategory.replace("_", " ")}${sleeve} (main colour ${g.color_hex})`;
  const name = cleanFreeText(spec.name ?? "", 120);
  return name ? `"${name}": ${base}` : base;
}

/**
 * The full redraw prompt from a free garment description (the MCP path, where Claude writes it from the photo) plus
 * optional fixes and owner notes. The three middle sentences are the prompt every redraw so far was made with.
 */
export function redrawPrompt(description: string, extras: { details?: string[]; fixes?: string[]; notes?: RedrawFree[] } = {}): string {
  const details = extras.details ?? [];
  const notes = extras.notes ?? [];
  const noteText = (kind: RedrawFree["kind"]) =>
    notes
      .filter((n) => n.kind === kind)
      .map((n) => `"${n.text}"`)
      .join("; ");
  const detailNotes = noteText("detail");
  const fixNotes = noteText("fix");
  const fixes = extras.fixes ?? [];
  return [
    `This is a photo of one garment: ${description}.`,
    details.length > 0 ? `Details to keep visible: ${details.join(", ")}.` : "",
    // don't touch / the owner types in Hebrew; image models tend to paint quoted words onto the garment as lettering.
    detailNotes ? `Owner's notes on the garment (may be in Hebrew; follow them, never draw them as text or letters): ${detailNotes}.` : "",
    "Parts of it may be hidden, creased, or overlapped by other clothes.",
    "Render the complete garment as a clean e-commerce product photo: alone, laid flat or as if on an invisible mannequin, front view, centred, filling most of the frame.",
    "Background: plain pure white (#FFFFFF), no shadow, no floor, no hanger, no person, no other clothing or objects.",
    "Keep the exact colour, pattern, fabric texture, buttons, logos and proportions. Complete hidden parts plausibly and smooth creases, but do not restyle it and do not add text.",
    fixes.length > 0 ? `Corrections for this photo: ${fixes.join(" ")}` : "",
    fixNotes ? `Owner's corrections (may be in Hebrew; follow them, never draw them as text or letters): ${fixNotes}.` : "",
  ]
    .filter(Boolean)
    .join(" ");
}

/** The prompt the image model receives for a spec. Pure, so the app previews exactly what the server sends. */
export function buildRedrawPrompt(spec: RedrawSpec): string {
  return redrawPrompt(describeRedrawGarment(spec), {
    details: spec.details.map((id) => detailDef(id).en),
    fixes: spec.fixes.map((id) => REDRAW_FIXES[id]),
    notes: spec.free,
  });
}

/** Details offered for a garment type, in vocabulary order. */
export function detailsFor(subcategory: Subcategory): RedrawDetailId[] {
  return REDRAW_DETAIL_IDS.filter((id) => detailDef(id).for.includes(subcategory));
}
