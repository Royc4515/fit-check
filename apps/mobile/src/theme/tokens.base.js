/**
 * Design tokens from DESIGN.md section 2. Plain CommonJS (tokens.base.js) so tailwind.config.js can
 * require it; `tokens.ts` re-exports for app code.
 *
 * Rule: nothing visual in the app may use a value that is not in this file.
 */
const colors = {
  ivory: "#F6F2EA",
  "ivory-deep": "#EDE7DB",
  ink: "#1B1A17",
  "ink-soft": "#5A5750",
  "ink-faint": "#A39F95",
  hairline: "#D9D3C6",
  accent: "#7A1F2B",
  "accent-ink": "#F6F2EA",
  ok: "#3F5A3C",
  warn: "#8A5A1E",
  transparent: "transparent",
};

// Font family keys map to the names registered in useFonts (see src/theme/fonts.ts).
const fontFamily = {
  display: ["FrankRuhlLibre_500Medium"],
  body: ["IBMPlexSansHebrew_400Regular"],
  "body-semibold": ["IBMPlexSansHebrew_600SemiBold"],
  mono: ["IBMPlexMono_400Regular"],
};

// [size, { lineHeight }] — line heights per DESIGN.md (Hebrew needs 1.7 on body).
const fontSize = {
  "display-xl": ["40px", { lineHeight: "46px" }],
  display: ["28px", { lineHeight: "34px" }],
  title: ["20px", { lineHeight: "27px" }],
  body: ["16px", { lineHeight: "27px" }],
  "body-sm": ["14px", { lineHeight: "22px" }],
  meta: ["12px", { lineHeight: "18px" }],
  num: ["16px", { lineHeight: "22px" }],
};

// Scale of 4; screen gutter is 20 (the one exception), sections 48, cards 12.
const spacing = {
  0: "0px",
  1: "4px",
  2: "8px",
  3: "12px",
  4: "16px",
  5: "20px",
  6: "24px",
  8: "32px",
  12: "48px",
  16: "64px",
  24: "96px",
};

const borderRadius = {
  none: "0px",
  sm: "2px",
  DEFAULT: "6px",
  md: "6px",
  lg: "8px",
};

module.exports = { tokens: { colors, fontFamily, fontSize, spacing, borderRadius } };
