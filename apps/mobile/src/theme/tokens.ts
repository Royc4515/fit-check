// Typed view of tokens.base.js for app code (e.g. `colors.accent` in a Reanimated style).
import type { ViewStyle } from "react-native";
import { tokens as raw, type ColorToken } from "./tokens.base.js";

export type { ColorToken };

export const colors: Readonly<Record<ColorToken, string>> = raw.colors;

export const motion = {
  // DESIGN.md section 2 "תנועה". ease-out only; springs critically damped (no overshoot).
  easeOut: [0.2, 0, 0, 1] as const,
  pressMs: 120,
  stateMs: 180,
  layoutMs: 280,
  screenMs: 420,
  /** Delay between tiles on the first masonry entrance. */
  staggerMs: 40,
  /** Only the first N tiles stagger; past that a cascade reads as slow. */
  staggerMax: 8,
  /** One full skeleton pulse (1 → 0.55 → 1). */
  skeletonMs: 1200,
  spring: { damping: 36, stiffness: 320, mass: 1 },
} as const;

/**
 * The two shadows DESIGN.md allows (section 2 "צורה"). `boxShadow` is a real style prop on RN 0.88 (new
 * architecture, iOS and Android) and react-native-web passes the string through to CSS, so one string serves every
 * platform; no elevation/shadowOffset pairs that render differently per OS.
 */
export const shadow = {
  /** A pressed or dragged tile. */
  lift: { boxShadow: "0 6px 16px rgba(27,26,23,0.10)" },
  /** An open sheet or floating action bar. The hairline on top is the component's border, not part of the shadow. */
  sheet: { boxShadow: "0 -8px 24px rgba(27,26,23,0.08)" },
} as const satisfies Record<string, ViewStyle>;

/** DESIGN.md sections 2-3. Only numbers the spec states; everything else derives from these. */
export const layout = {
  gutter: 20,
  /** Wardrobe and other grid screens use a tighter gutter than text screens. */
  gridGutter: 16,
  /** Gap between masonry tiles (Pinterest-tight). */
  gridGap: 8,
  /** Visible part of the collapsed action sheet (DESIGN.md section 3: "עולה 56px מהקצה"). */
  sheetPeek: 56,
  /** Bottom tab bar, without the safe area. */
  tabBarHeight: 56,
  /** Desktop top navigation. */
  topNavHeight: 64,
  /** From this width the app is "desktop": top nav, dialogs instead of sheets, two columns. */
  desktopMin: 900,
  /** Overlap between staggered outfit pieces. */
  overlap: 8,
  /** DESIGN.md section 3: web content is capped and centered, same screen as mobile. */
  maxContentWidth: 560,
  /** Desktop shell (grids, two-column screens). */
  maxContentWidthWide: 1200,
  /** Minimum touch target. */
  hit: 44,
  /** Button and the centre Add square. */
  control: 48,
  /** Visible chip height; hitSlop brings it to `hit`. */
  chip: 36,
  /** Desktop dialog width (the sheet at >= desktopMin). */
  dialogWidth: 480,
  /**
   * Masonry columns by window width (DESIGN.md section 3 "ארון" item 4): `maxWidth` is exclusive. The last entry
   * has no bound.
   */
  masonryColumns: [
    { maxWidth: 600, columns: 2 },
    { maxWidth: 900, columns: 3 },
    { maxWidth: 1200, columns: 4 },
    { maxWidth: Infinity, columns: 5 },
  ],
} as const;

/**
 * Masonry column count for a container width.
 * @param width - window or container width in px.
 * @returns 2-5 per DESIGN.md; never throws (NaN or negative falls into the narrowest bucket).
 */
export function masonryColumnsFor(width: number): number {
  for (const b of layout.masonryColumns) if (!(width >= b.maxWidth)) return b.columns;
  return 5;
}
