/*
 * The measures Today's frame (TodayFrame) and the screen with its outfit (TodayView) share. One set, so the masthead,
 * the day tabs and the hero's top edge stand at the same place in both and nothing moves when the outfit arrives.
 */

/** Space kept between the last line of content and the floating bar's top edge. */
export const UNDER_BAR = 32;
/** Desktop: the flat-lay column is at most this wide (DESIGN.md section 3 "היום" item 9). */
export const DESKTOP_HERO_MAX = 560;
/** Air above and below the desktop flat-lay, which must fit whole in the viewport under the top nav. */
export const DESKTOP_HERO_PAD = 32;
export const DESKTOP_GAP = 64;
export const DESKTOP_GUTTER = 32;
/** Desktop: space between the day tabs and the flat-lay under them. */
export const DESKTOP_TABS_GAP = 24;
/** Mobile layout's scroll padding above the masthead, and the space between masthead and flat-lay (see TodayView). */
export const MOBILE_TOP = 24;
export const MOBILE_HERO_GAP = 16;
/** Ids of the day tabs and their panel (WAI-ARIA tabs pattern). */
export const DAY_TABS = "today-day";
