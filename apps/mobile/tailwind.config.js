const { tokens } = require("./src/theme/tokens.base.js");

/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./src/**/*.{ts,tsx}"],
  presets: [require("nativewind/preset")],
  // don't touch / without this, NativeWind on web defaults to darkMode "media" and its stylesheet observer then calls
  // colorScheme.set(), which throws for "media" on every load: a full-screen red "Uncaught Error" overlay in dev.
  // We ship light only (DESIGN.md section 1) and use no `dark:` variants, so "class" changes nothing visually.
  darkMode: "class",
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
