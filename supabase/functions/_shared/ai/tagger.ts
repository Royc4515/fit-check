import Anthropic from "@anthropic-ai/sdk";
import {
  COLOR_NAMES,
  FITS,
  MATERIALS,
  MODESTY_FLAGS,
  PATTERNS,
  SEASONS,
  SLEEVES,
  STYLE_TAGS,
  SUBCATEGORIES,
  SUBCATEGORY_TO_CATEGORY,
} from "@fit-check/schema/item-tags.ts";
import { TagProposalSchema, type TagModel, type TagProposal } from "@fit-check/schema/intake.ts";
import type { AiLogEntry } from "./types.ts";

/** CLAUDE.md default. Sonnet is the candidate under trial; see TAG_MODELS. */
export const DEFAULT_TAG_MODEL: TagModel = "claude-haiku-5-5";

/** USD per token, Claude API list prices (2026-10): Haiku 5.5 $0.10/$0.50, Sonnet 5.5 $2/$10 per million. */
const PRICE: Record<TagModel, { input: number; output: number; cacheRead: number }> = {
  "claude-haiku-5-5": { input: 0.1 / 1e6, output: 0.5 / 1e6, cacheRead: 0.01 / 1e6 },
  "claude-sonnet-5-5": { input: 2 / 1e6, output: 10 / 1e6, cacheRead: 0.2 / 1e6 },
};

const UNCERTAIN_FIELDS = ["subcategory", "color", "pattern", "material", "fit"] as const;

/**
 * The tagger's instructions. Stable text only (it is cached); anything per request goes in the user turn.
 * don't touch / the fabric and subcategory guides exist because of real misses on Roy's first photos (2026-11-08):
 * a sweater tagged as a shirt, melange tailored trousers tagged as chinos, a wool knit tagged as cotton.
 */
const SYSTEM = `You tag one men's garment from a photo for a personal wardrobe app. The owner will review every field, so be precise and say where the photo cannot settle a field.

The photo may also show other clothes (hanging behind it in a closet, on a bed, at the edges). Tag only the main garment: the one in front and closest to the centre. Ignore the others completely, including their colours.

Subcategory (pick the garment type, not the slot):
- knit: anything knitted from yarn: crew/V-neck sweaters, cardigans, knitted polos with long sleeves, quarter-zips in knit. Visible knit stitches or ribbed cuffs/hem.
- sweatshirt: cut-and-sewn jersey or fleece-backed cotton: crewneck sweatshirts, hoodies, zip hoodies. Smooth face, no knit stitches.
- button_down: any woven shirt with a buttoned placket, including mandarin/band collar, oxford, flannel, linen and overshirts worn as shirts.
- polo: short-sleeved pique or jersey with a 2-3 button placket.
- tshirt: jersey tee, any neckline.
- chinos: casual cotton twill trousers, slanted front pockets, no pressed crease, slightly sheeny diagonal weave.
- trousers: tailored or dress trousers: pressed centre crease, finer cloth (wool, wool blend, flannel, melange suiting), cleaner waistband; also jogger-like smart trousers that are not chinos or jeans.
- jeans: denim, visible twill with indigo/contrast yarn, rivets, five pockets.
- shorts; sneakers; boots; dress_shoes; sandals; coat (below hip); jacket (to hip, including bombers, fleeces, shells, blazers); belt; watch; hat.

Pattern:
- melange: heathered yarn, fine flecks of two or more shades of the same colour (classic grey marl). It is NOT solid even when it reads as one colour from afar.
- solid / stripes / check / print / denim as usual.

Material (fibre, not weave):
- wool: matte surface, slight fuzzy halo at the edges, springy thick knit, soft drape; merino is finer and flatter but still matte. Flannel trousers are wool.
- cotton: crisp, defined stitches, flatter and slightly shiny surface, no halo; twill chinos, oxford cloth, jersey, sweatshirt fleece.
- linen: slubby irregular yarn, visible creases, slightly translucent.
- denim, leather, suede as usual. synthetic: technical shells, fleece jackets, sports kit, shiny or plasticky surfaces.
- mixed: a care label shows no fibre at 50% or more.
- unknown: when wool versus cotton (or similar) cannot be told from the photo and there is no label. Prefer unknown plus "material" in uncertain over a confident wrong guess.
- A care label photo, when given, overrides everything: report its composition text in label_composition and take material from the fibre at 50% or more ("synthetic" for polyester, nylon, acrylic, elastane).

Colour:
- color_hex is the garment's own dominant colour as it would look in neutral daylight: correct for warm indoor light, shadows and camera white balance (use the background and any white parts as a reference). Sample the main body of the garment, not seams, shadows or highlights.
- color_name is the closest of the allowed names to that hex. Navy is a dark blue that reads almost black; light_blue is a pale sky blue; cream and beige are warm off-whites; olive is a muted yellow-green.
- secondary_color_hex: the second colour of a pattern (stripes, check, melange flecks), else null.

Other fields:
- fit: from the cut you can see (slim, regular, relaxed, oversized). Usually regular.
- sleeve: na for anything without sleeves to judge (trousers, shoes, accessories).
- formality, 1-10: gym kit 1, hoodie or sandals 2, sweatshirt 3, t-shirt or sneakers 4, polo or casual knit 5, casual button-down 6, chinos, oxford or fine knit 7, tailored trousers or dress shoes 8, suit pieces 9.
- seasons and temp_min_c/temp_max_c (the outdoor temperatures it suits, Celsius): t-shirt or linen 20 to 40; polo 18 to 35; button-down 14 to 32; cotton knit or sweatshirt 10 to 22; wool knit 0 to 17; jacket 5 to 18; coat -5 to 12; trousers by cloth weight.
- modesty_flags: short_sleeve for short sleeves, short_pants for shorts, open_front for garments worn open (cardigans, unbuttoned overshirts). Else empty.
- style_tags: zero to three of the allowed values.

name: English, in the wardrobe's existing style "Brand Type" (e.g. "Gap Chinos", "Zara Mandarin Collar", "Nike Sweatshirt"). Without a visible brand use colour and type ("Navy Wool Sweater"). brand: only when a logo or label shows it, else null.

uncertain: list every field among subcategory, color, pattern, material, fit that the photo cannot settle. An empty list means you would bet on every field.`;

/** JSON schema the API enforces. Numeric ranges and the hex format are checked by zod afterwards. */
const OUTPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["name", "brand", "tags", "label_composition", "uncertain"],
  properties: {
    name: { type: "string" },
    brand: { type: ["string", "null"] },
    label_composition: { type: ["string", "null"] },
    uncertain: { type: "array", items: { type: "string", enum: [...UNCERTAIN_FIELDS] } },
    tags: {
      type: "object",
      additionalProperties: false,
      required: [
        "subcategory", "color_hex", "color_name", "secondary_color_hex", "pattern", "material", "fit", "sleeve",
        "formality", "seasons", "temp_min_c", "temp_max_c", "modesty_flags", "style_tags",
      ],
      properties: {
        subcategory: { type: "string", enum: [...SUBCATEGORIES] },
        color_hex: { type: "string" },
        color_name: { type: "string", enum: [...COLOR_NAMES] },
        secondary_color_hex: { type: ["string", "null"] },
        pattern: { type: "string", enum: [...PATTERNS] },
        material: { type: "string", enum: [...MATERIALS] },
        fit: { type: "string", enum: [...FITS] },
        sleeve: { type: "string", enum: [...SLEEVES] },
        formality: { type: "integer" },
        seasons: { type: "array", items: { type: "string", enum: [...SEASONS] } },
        temp_min_c: { type: "integer" },
        temp_max_c: { type: "integer" },
        modesty_flags: { type: "array", items: { type: "string", enum: [...MODESTY_FLAGS] } },
        style_tags: { type: "array", items: { type: "string", enum: [...STYLE_TAGS] } },
      },
    },
  },
} as const;

/** A past confirmation where Roy changed something; fed back as an example. */
export type TagCorrection = { name: string; changed: string[]; proposed: Record<string, unknown>; final: Record<string, unknown> };
/** One existing wardrobe item, compact: lets the tagger reuse the owner's names and brands. */
export type WardrobeLine = { name: string; brand: string | null; subcategory: string; color_name: string; material: string };

export type TagInput = {
  image: { bytes: Uint8Array; mediaType: string };
  label?: { bytes: Uint8Array; mediaType: string };
  hint?: string;
  wardrobe: WardrobeLine[];
  corrections: TagCorrection[];
  model: TagModel;
};

export type TagResult = { proposal: TagProposal | null; log: AiLogEntry };

function correctionLines(corrections: TagCorrection[]): string {
  if (corrections.length === 0) return "";
  const lines = corrections.map((c) => {
    const diffs = c.changed.map((f) => `${f}: you said ${JSON.stringify(c.proposed[f])}, it is ${JSON.stringify(c.final[f])}`);
    return `- ${c.name}: ${diffs.join("; ")}`;
  });
  return `The owner corrected these recent tags of yours. Learn the pattern (how his fabrics and colours look in his photos), do not copy values blindly:\n${lines.join("\n")}`;
}

function base64(bytes: Uint8Array): string {
  let s = "";
  // don't touch / chunked: spreading a whole photo into fromCharCode overflows the call stack.
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"] as const;
type ImageType = (typeof IMAGE_TYPES)[number];
const asImageType = (t: string): ImageType => ((IMAGE_TYPES as readonly string[]).includes(t) ? (t as ImageType) : "image/jpeg");

/**
 * tagItem: proposes the full frozen tag set for one cropped garment (CLAUDE.md: Claude, structured output).
 *
 * Inputs: the crop, an optional care-label photo, detection's hint, the owner's wardrobe (names and brands) and his
 * latest corrections. Category is derived from the subcategory here, never asked for, so the two cannot disagree.
 * Failure modes, returned as `proposal: null` with the reason in `log.error` (never thrown): missing key, API error,
 * refusal, truncated output, JSON that does not parse, or tags that fail ItemTagsSchema.
 */
export async function tagItem(input: TagInput): Promise<TagResult> {
  const started = Date.now();
  const base = { provider: "anthropic" as const, model: input.model, task: "tag" as const, images: input.label ? 2 : 1 };
  const fail = (error: string, usage?: Anthropic.Beta.BetaUsage): TagResult => ({
    proposal: null,
    log: { ...base, latency_ms: Date.now() - started, ok: false, error: error.slice(0, 300), ...(usage ? cost(input.model, usage) : {}) },
  });

  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) return fail("ANTHROPIC_API_KEY is not set");
  const client = new Anthropic({ apiKey, maxRetries: 1, timeout: 60_000 });

  const wardrobe = input.wardrobe
    .map((w) => `${w.name}${w.brand ? ` [${w.brand}]` : ""}: ${w.subcategory}, ${w.color_name}, ${w.material}`)
    .join("\n");
  const content: Anthropic.Beta.BetaContentBlockParam[] = [
    { type: "image", source: { type: "base64", media_type: asImageType(input.image.mediaType), data: base64(input.image.bytes) } },
  ];
  if (input.label) {
    content.push({ type: "text", text: "Care label of the same garment:" });
    content.push({ type: "image", source: { type: "base64", media_type: asImageType(input.label.mediaType), data: base64(input.label.bytes) } });
  }
  const notes = [
    input.hint ? `A detector described it as: "${input.hint}". It is often wrong about type and fabric; trust the photo.` : "",
    correctionLines(input.corrections),
    "Tag this garment.",
  ].filter(Boolean);
  content.push({ type: "text", text: notes.join("\n\n") });

  try {
    const sonnet = input.model === "claude-sonnet-5-5";
    const response = await client.beta.messages.create({
      model: input.model,
      max_tokens: 8000,
      output_config: { effort: "medium", format: { type: "json_schema", schema: OUTPUT_SCHEMA } },
      // Only Sonnet has the server-side fallback; a declined Haiku call just fails and the user tags by hand.
      ...(sonnet ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
      system: [
        { type: "text", text: SYSTEM },
        // The wardrobe changes only when an item is added, so the system prefix is reused across a batch.
        { type: "text", text: `The owner's wardrobe so far:\n${wardrobe || "(empty)"}`, cache_control: { type: "ephemeral" } },
      ],
      messages: [{ role: "user", content }],
    });

    const usage = response.usage;
    if (response.stop_reason === "refusal") return fail("refusal", usage);
    if (response.stop_reason === "max_tokens") return fail("max_tokens", usage);
    const text = response.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      return fail("invalid JSON", usage);
    }
    const parsed = TagProposalSchema.safeParse(withCategory(raw));
    if (!parsed.success) return fail(`schema: ${parsed.error.issues[0]?.path.join(".")} ${parsed.error.issues[0]?.message}`, usage);
    return { proposal: parsed.data, log: { ...base, latency_ms: Date.now() - started, ok: true, ...cost(input.model, usage) } };
  } catch (error) {
    if (error instanceof Anthropic.RateLimitError) return fail("rate limited");
    if (error instanceof Anthropic.AuthenticationError) return fail("authentication failed (check ANTHROPIC_API_KEY)");
    if (error instanceof Anthropic.APIError) return fail(`API ${error.status}: ${error.message}`);
    return fail(`network: ${String(error)}`);
  }
}

/** Adds `category` from the subcategory and upper-cases hex values, so the model cannot produce a mismatched slot. */
function withCategory(raw: unknown): unknown {
  if (typeof raw !== "object" || raw === null) return raw;
  const r = raw as { tags?: Record<string, unknown> };
  const tags = r.tags;
  if (!tags || typeof tags.subcategory !== "string") return raw;
  const category = SUBCATEGORY_TO_CATEGORY[tags.subcategory as keyof typeof SUBCATEGORY_TO_CATEGORY];
  const upper = (v: unknown) => (typeof v === "string" ? v.toUpperCase() : v);
  return { ...r, tags: { ...tags, category, color_hex: upper(tags.color_hex), secondary_color_hex: upper(tags.secondary_color_hex) } };
}

function cost(model: TagModel, usage: Anthropic.Beta.BetaUsage) {
  const p = PRICE[model];
  const cached = usage.cache_read_input_tokens ?? 0;
  const written = usage.cache_creation_input_tokens ?? 0;
  // Cache writes cost 1.25x input; reads about 0.1x. Close enough for a cost-visibility estimate.
  const usd = usage.input_tokens * p.input + written * p.input * 1.25 + cached * p.cacheRead + usage.output_tokens * p.output;
  return {
    input_tokens: usage.input_tokens + cached + written,
    output_tokens: usage.output_tokens,
    cost_usd: Math.round(usd * 100_000) / 100_000,
  };
}
