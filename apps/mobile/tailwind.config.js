const { tokens } = require("./src/theme/tokens.base.js");

/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./src/**/*.{ts,tsx}"],
  presets: [require("nativewind/preset")],
  theme: {
    // The DESIGN.md tokens are the ONLY palette. No Tailwind defaults leak in.
    colors: tokens.colors,
    fontFamily: tokens.fontFamily,
    fontSize: tokens.fontSize,
    spacing: tokens.spacing,
    borderRadius: tokens.borderRadius,
    extend: {},
  },
  plugins: [],
};
