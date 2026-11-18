// Hand-written types for tokens.base.js (CommonJS, shared with tailwind.config.js).

/** Every colour name in DESIGN.md section 2. A literal union so a typo is a type error, not `undefined`. */
export type ColorToken =
  | "ivory"
  | "ivory-deep"
  | "ink"
  | "ink-soft"
  | "ink-faint"
  | "hairline"
  | "accent"
  | "accent-ink"
  | "ok"
  | "warn"
  | "scrim"
  | "tile"
  | "tile-deep"
  | "tile-cool"
  | "transparent";

export const tokens: {
  colors: Record<ColorToken, string>;
  fontFamily: Record<string, string[]>;
  fontSize: Record<string, [string, { lineHeight: string }]>;
  spacing: Record<string, string>;
  borderRadius: Record<string, string>;
};
