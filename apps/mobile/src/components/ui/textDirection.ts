// Hebrew and Arabic blocks: the scripts that read right to left in this app.
const STRONG_RTL = /[֐-ࣿיִ-﷿ﹰ-﻿]/;
const STRONG_LTR = /[A-Za-zÀ-ɏͰ-ϿЀ-ӿ]/;

/**
 * The writing direction a string should be drawn in, from the script that dominates it: the one with more letters,
 * the first strong character breaking a tie. Plain "first strong" is not enough for a row label like
 * "חולצה · Carhartt WIP Detroit Jacket": it opens with a short Hebrew type word, so it would be a right-to-left
 * paragraph whose long Latin run overflows at the visual left, and the ellipsis then eats the START of the name.
 * Dominant script makes that a left-to-right run (the name's beginning stays), while a Hebrew sentence with one
 * Latin word stays right-to-left.
 *
 * @param text The visible string. Digits, spaces and punctuation are neutral and not counted.
 * @param fallback Direction for a string with no letters and no digits (empty, "·"): pass the layout's own. A string
 * of digits only ("4", "18:30") is left-to-right in either layout, as the browser's own auto-detection had it.
 * @returns "rtl" or "ltr", for `style.writingDirection`.
 */
export function textDirection(text: string, fallback: "rtl" | "ltr"): "rtl" | "ltr" {
  let rtl = 0;
  let ltr = 0;
  let first: "rtl" | "ltr" | null = null;
  for (const ch of text) {
    if (STRONG_RTL.test(ch)) {
      rtl += 1;
      first ??= "rtl";
    } else if (STRONG_LTR.test(ch)) {
      ltr += 1;
      first ??= "ltr";
    }
  }
  if (rtl === ltr) return first ?? (/\d/.test(text) ? "ltr" : fallback);
  return rtl > ltr ? "rtl" : "ltr";
}
