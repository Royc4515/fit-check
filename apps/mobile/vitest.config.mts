import { defineConfig } from "vitest/config";

// Only the app's pure modules (no React Native, no Expo): the edit queue and path rules of the item screen. Screens
// are checked in the browser; this runner never imports react-native.
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
});
