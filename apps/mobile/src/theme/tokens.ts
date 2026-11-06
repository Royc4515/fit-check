// Typed view of tokens.base.js for app code (e.g. `colors.accent` in a Reanimated style).
import { tokens as raw } from "./tokens.base.js";

export const colors = raw.colors as Readonly<Record<string, string>>;
export const motion = {
  // DESIGN.md section 4. ease-out only; springs with high damping.
  easeOut: [0.2, 0, 0, 1] as const,
  stateMs: 180,
  layoutMs: 280,
  screenMs: 420,
  spring: { damping: 28, stiffness: 320, mass: 1 },
} as const;
