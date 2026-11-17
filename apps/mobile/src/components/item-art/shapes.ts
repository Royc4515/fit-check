import type { Subcategory } from "@fit-check/schema";

/**
 * Technical-flat drawings, one per subcategory, all on a 100x100 viewBox with a shared optical size so a grid of
 * them reads as one catalogue. `body` is the filled silhouette (it also clips the fabric pattern); `details` are
 * construction lines (placket, fly, seams) drawn in a darker shade; `dots` are buttons and eyelets.
 *
 * These stand in for real cutouts until photo intake exists, and keep working afterwards for items without one.
 */
export type Shape = {
  body: string;
  details?: string[];
  dots?: Array<[number, number]>;
  /** Pieces drawn on top of the body in the base colour (a buckle, a watch face). */
  overlays?: string[];
  /**
   * SVG transform that re-centres a low, flat drawing (shoes) so it fills the frame like the others. Without it a
   * shoe sat in the bottom third of a 3:4 grid tile and read as an empty card.
   */
  fit?: string;
};

// Shoes are drawn on a ground line around y=80; lift their centre (~y64) to the frame centre and enlarge slightly.
const SHOE_FIT = "translate(50 50) scale(1.18) translate(-50.5 -64.5)";

const LONG_SLEEVE_TOP = "M36 12 L43 9 L50 15 L57 9 L64 12 L78 18 L88 68 L79 71 L70 36 L70 90 L30 90 L30 36 L21 71 L12 68 L22 18 Z";
const SHORT_SLEEVE_TOP = "M36 12 L43 9 L50 15 L57 9 L64 12 L84 23 L78 38 L69 34 L69 88 L31 88 L31 34 L22 38 L16 23 Z";
const TROUSERS = "M30 8 L70 8 L74 92 L56 92 L50 36 L44 92 L26 92 Z";

export const SHAPES: Record<Subcategory, Shape> = {
  // A shirt worn open: the two front edges stand apart over the tee underneath.
  overshirt: {
    body: LONG_SLEEVE_TOP,
    details: ["M43 9 L46 19 L48 17 L48 90", "M57 9 L54 19 L52 17 L52 90", "M34 30 L44 30 L44 38 L34 38", "M56 30 L66 30 L66 38 L56 38", "M21 64 L29 66", "M79 64 L71 66"],
    dots: [[46, 28], [46, 44], [46, 60], [46, 76]],
  },
  button_down: {
    body: LONG_SLEEVE_TOP,
    details: ["M43 9 L46 19 L50 15 L54 19 L57 9", "M50 15 L50 90", "M21 64 L29 66", "M79 64 L71 66"],
    dots: [[52.5, 28], [52.5, 41], [52.5, 54], [52.5, 67], [52.5, 80]],
  },
  tshirt: {
    body: SHORT_SLEEVE_TOP,
    details: ["M43 9 Q50 20 57 9", "M24 33 L30 30", "M76 33 L70 30"],
  },
  polo: {
    body: SHORT_SLEEVE_TOP,
    details: ["M43 9 L46 18 L50 14 L54 18 L57 9", "M50 14 L50 30", "M24 33 L30 30", "M76 33 L70 30"],
    dots: [[52, 21], [52, 27]],
  },
  knit: {
    body: LONG_SLEEVE_TOP,
    details: ["M43 9 Q50 18 57 9", "M30 84 L70 84", "M21 64 L29 66", "M79 64 L71 66"],
  },
  sweatshirt: {
    body: LONG_SLEEVE_TOP,
    details: ["M43 9 Q50 18 57 9", "M30 83 L70 83", "M21 63 L29 65", "M79 63 L71 65", "M38 60 L62 60 L64 76 L36 76 Z"],
  },
  jeans: {
    body: TROUSERS,
    details: ["M30 15 L70 15", "M33 15 Q37 25 42 15", "M67 15 Q63 25 58 15", "M50 15 L50 34", "M47 15 L47 30"],
    dots: [[50, 12]],
  },
  chinos: {
    body: TROUSERS,
    details: ["M30 15 L70 15", "M32 15 L37 28", "M68 15 L63 28", "M50 15 L50 32", "M38 34 L35 90", "M62 34 L65 90"],
    dots: [[50, 12]],
  },
  trousers: {
    body: TROUSERS,
    details: ["M30 14 L70 14", "M50 14 L50 32", "M38 22 L37 90", "M62 22 L63 90", "M36 8 L36 14", "M64 8 L64 14"],
  },
  shorts: {
    body: "M30 22 L70 22 L75 64 L54 64 L50 44 L46 64 L25 64 Z",
    details: ["M30 29 L70 29", "M32 29 L37 40", "M68 29 L63 40", "M50 29 L50 42"],
    dots: [[50, 26]],
  },
  sneakers: {
    fit: SHOE_FIT,
    body: "M12 74 Q12 58 28 56 L42 51 Q50 48 57 55 L74 61 Q90 63 90 73 L90 80 L12 80 Z",
    details: ["M12 74 L90 74", "M44 54 L50 60", "M48 52 L55 58", "M52 51 L59 57", "M28 56 Q31 66 26 74"],
  },
  boots: {
    body: "M22 80 L22 26 L44 26 L46 58 L70 64 Q87 67 87 76 L87 80 Z",
    details: ["M22 76 L87 76", "M38 30 Q36 44 42 58", "M44 26 L44 18 L40 18 L40 26"],
  },
  dress_shoes: {
    fit: SHOE_FIT,
    body: "M10 77 Q12 66 27 63 L45 59 Q55 57 62 61 L79 66 Q91 69 91 77 L91 80 L10 80 Z",
    details: ["M10 77 L91 77", "M66 63 Q72 72 80 67", "M40 60 L52 66", "M44 59 L54 64"],
  },
  sandals: {
    fit: SHOE_FIT,
    body: "M12 78 Q12 72 28 72 L80 72 Q90 72 90 78 L90 81 L12 81 Z",
    details: ["M32 72 Q41 55 51 72", "M57 72 Q64 59 72 72"],
  },
  coat: {
    body: "M34 8 L42 6 L50 30 L58 6 L66 8 L80 16 L88 74 L80 76 L72 34 L72 96 L28 96 L28 34 L20 76 L12 74 L20 16 Z",
    details: ["M42 6 L40 22 L50 30", "M58 6 L60 22 L50 30", "M50 30 L50 96", "M32 70 L44 70", "M56 70 L68 70"],
    dots: [[54, 46], [54, 60], [46, 46], [46, 60]],
  },
  jacket: {
    body: "M34 10 L42 8 L50 26 L58 8 L66 10 L80 18 L88 70 L80 72 L72 34 L72 76 L28 76 L28 34 L20 72 L12 70 L20 18 Z",
    details: ["M42 8 L41 20 L50 26", "M58 8 L59 20 L50 26", "M50 26 L50 76", "M32 60 L43 60", "M57 60 L68 60", "M28 70 L72 70"],
  },
  belt: {
    body: "M8 45 L78 45 L78 56 L8 56 Z",
    details: ["M78 41 L93 41 L93 60 L78 60 Z", "M78 50.5 L90 50.5"],
    dots: [[22, 50.5], [29, 50.5], [36, 50.5]],
  },
  watch: {
    body: "M42 8 L58 8 L58 92 L42 92 Z",
    overlays: ["M50 31 A19 19 0 1 1 49.99 31 Z"],
    details: ["M50 36 A14 14 0 1 1 49.99 36 Z", "M50 50 L50 41", "M50 50 L57 54"],
  },
  hat: {
    body: "M24 70 Q24 26 50 24 Q76 26 76 70 Z",
    details: ["M22 70 L78 70 L78 82 L22 82 Z", "M32 70 L32 82", "M41 70 L41 82", "M50 70 L50 82", "M59 70 L59 82", "M68 70 L68 82"],
  },
};
