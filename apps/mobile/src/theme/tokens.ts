// Typed view of tokens.base.js for app code (e.g. `colors.accent` in a Reanimated style).
import { tokens as raw } from "./tokens.base.js";

export const colors = raw.colors as Readonly<Record<string, string>>;
export const motion = {
  // DESIGN.md section 4. ease-out only; springs with high damping.
  easeOut: [0.2, 0, 0, 1] as const,
  stateMs: 180,
  layoutMs: 280,
  screenMs: 420,
  spring: { damping: 36, stiffness: 320, mass: 1 },
} as const;

/** DESIGN.md sections 2-3. Only numbers the spec states; everything else derives from these. */
export const layout = {
  gutter: 20,
  /** Visible part of the collapsed action sheet (DESIGN.md section 3: "עולה 56px מהקצה"). */
  sheetPeek: 56,
  /** Overlap between staggered outfit pieces. */
  overlap: 8,
  /** DESIGN.md section 3: web content is capped and centered, same screen as mobile. */
  maxContentWidth: 560,
} as const;
