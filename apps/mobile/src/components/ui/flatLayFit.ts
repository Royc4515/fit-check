import { layout } from "../../theme/tokens";

/** The flat-lay's height / width (4:5). Repeated from FlatLay.tsx so this file stays free of React Native imports. */
const ASPECT = 1.25;

/**
 * Air kept between the flat-lay's bottom edge and whatever ends the free space at scroll top: a floating bar's top,
 * or the bottom of the scene (the tab bar's top, or the window's bottom on a screen without a bar). DESIGN.md
 * section 3 "היום" item 2.
 */
export const HERO_CLEARANCE = 16;

/**
 * The 4:5 composition is never narrower than this when capping (a short window would otherwise shrink the hero to a
 * thumbnail); below it the hero keeps this size and the page scrolls.
 */
export const HERO_MIN = 240;

/** Below the desktop layout, windows at least this wide show the flat-lay as a centred card instead of full-bleed. */
export const CARD_MIN_WIDTH = 600;

export type FlatLayFitInput = {
  /** Every size below has been measured at least once; until then nothing is capped, so first paint does not jump. */
  measured: boolean;
  desktop: boolean;
  /** Window width. */
  width: number;
  /** The scene's height: from the top of the screen down to the tab bar's top, or the window's bottom without one. */
  viewportHeight: number;
  /** The hero's top edge at scroll top, from the scene's top (safe area and everything above the hero included). */
  heroTop: number;
  /** Height taken at the bottom by a floating bar that the hero must clear; 0 without one. */
  bottomReserved: number;
};

export type FlatLayFit = {
  /** Phone width (< CARD_MIN_WIDTH): the most the full-bleed surface may be high (FlatLay `maxHeight`). */
  maxHeight: number | undefined;
  /** 600-899: the centred card's width; null = no card (or not measured yet: the column width, plain 4:5). */
  cardWidth: number | null;
  /** The layout is the centred card (600-899), measured or not. */
  card: boolean;
  /**
   * The free height itself, before the floor and the card rule: what a caller needs to decide whether one more line
   * above the hero still leaves the flat-lay above its floor (Today's one-time tap hint).
   */
  space: number;
};

/**
 * "The flat-lay always fits on screen without scrolling" (DESIGN.md section 3 "היום" item 2), as numbers: the free
 * space runs from the hero's top edge to the floating bar (when there is one) or the scene's bottom, minus
 * HERO_CLEARANCE. Below 600 the surface stays full width and only its height is capped; 600-899 it becomes a centred
 * card as wide as the space allows; desktop is not capped here. Floor: HERO_MIN, under which the page scrolls.
 * Pure: Today and the outfit screen measure their own layouts and both ask this.
 */
export function fitFlatLay(input: FlatLayFitInput): FlatLayFit {
  const { measured, desktop, width, viewportHeight, heroTop, bottomReserved } = input;
  const space = viewportHeight - bottomReserved - heroTop - HERO_CLEARANCE;
  const card = !desktop && width >= CARD_MIN_WIDTH;
  const cardWidth = card && measured ? Math.max(HERO_MIN, Math.min(layout.maxContentWidth, space / ASPECT)) : null;
  const maxHeight = !desktop && !card && measured ? Math.max(HERO_MIN * ASPECT, space) : undefined;
  return { maxHeight, cardWidth, card, space };
}
