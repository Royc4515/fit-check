import { layout } from "../../theme/tokens";
import type { Rect } from "./transition";

/** DESIGN.md section 3 "פריט": the picture takes 56% of the screen height on a phone. */
export const HERO_SCREEN_FRACTION = 0.56;
/** Air around the garment inside the hero ground (Kinfolk: one object in a lot of air). Spacing-scale values. */
const PAD_PHONE = 48;
const PAD_DESKTOP = 64;
/** Desktop page: side padding, gap between the columns, and the hero's top/bottom margin. Spacing-scale values. */
const DESKTOP_SIDE = 32;
const DESKTOP_GAP = 48;
const DESKTOP_TOP = 32;
/** Desktop hero shape (height / width), the masonry's long-garment end: a column-wide picture, not a banner. */
const DESKTOP_ASPECT = 1.25;

export type HeroGeometry = {
  desktop: boolean;
  /** The hero ground in window coordinates with the page unscrolled. Physical x: RTL is resolved here. */
  ground: Rect;
  /** Logical start offset of the ground from the window's start edge, for laying it out with `start`. */
  start: number;
  /** Inset of the picture inside the ground. */
  pad: number;
  /** Desktop: the details column's width and its distance from the page's start edge. */
  column: { width: number; offsetStart: number } | null;
};

/**
 * Where the hero sits: full-bleed at the top on a phone; on desktop (>= 900) the start column of a two-column page
 * capped at 1200, held in place while the details scroll. Pure, so the flight can target the final rect on its first
 * frame, before anything has been laid out or measured.
 */
export function heroGeometry(windowW: number, windowH: number, rtl: boolean): HeroGeometry {
  if (windowW < layout.desktopMin) {
    const ground = { x: 0, y: 0, width: windowW, height: Math.round(windowH * HERO_SCREEN_FRACTION) };
    return { desktop: false, ground, start: 0, pad: PAD_PHONE, column: null };
  }
  const page = Math.min(windowW, layout.maxContentWidthWide);
  const colW = (page - 2 * DESKTOP_SIDE - DESKTOP_GAP) / 2;
  const height = Math.round(Math.min(windowH - 2 * DESKTOP_TOP, colW * DESKTOP_ASPECT));
  const startEdge = (windowW - page) / 2 + DESKTOP_SIDE;
  const x = rtl ? windowW - startEdge - colW : startEdge;
  return {
    desktop: true,
    ground: { x, y: DESKTOP_TOP, width: colW, height },
    start: startEdge,
    pad: PAD_DESKTOP,
    column: { width: colW, offsetStart: DESKTOP_SIDE + colW + DESKTOP_GAP },
  };
}
