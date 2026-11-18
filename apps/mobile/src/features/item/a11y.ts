/** Unicode bidi isolates (LRI, RLI, FSI, PDI): U+2066-U+2069. */
const ISOLATES = /[⁦-⁩]/g;

/**
 * A string for `accessibilityLabel` / `accessibilityHint`: the visible text keeps its bidi isolates (numbers stay LTR
 * inside Hebrew), but screen readers can read them out as symbols, so they are stripped from what is spoken.
 */
export function spoken(text: string): string {
  return text.replace(ISOLATES, "");
}
