import type { ColorName } from "@fit-check/schema";

/**
 * Hex used when the user picks a colour name by hand: the tagger's own hex no longer describes the garment then.
 * Same values as the sheet import (scripts/import-sheet.ts), so hand-picked and imported items match in the engine.
 */
export const COLOR_HEX: Record<ColorName, string> = {
  navy: "#1F2A44",
  white: "#F4F1EA",
  black: "#1B1A17",
  grey: "#8A8780",
  beige: "#C9B99A",
  brown: "#6B4A2B",
  olive: "#6B6B3A",
  burgundy: "#6E1F2B",
  blue: "#3B5B8C",
  light_blue: "#9DB9D8",
  red: "#A3282E",
  green: "#3F6B4A",
  orange: "#D2691E",
  yellow: "#D4A827",
  pink: "#E3A7B0",
  cream: "#EFE6D2",
};
