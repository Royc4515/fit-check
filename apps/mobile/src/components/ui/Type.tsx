import { useTranslation } from "react-i18next";
import { Platform, Text, type TextProps, type TextStyle } from "react-native";

/**
 * Language-dependent typography from DESIGN.md section 2, in one place: English display gets -0.01em tracking,
 * English meta is uppercase with 0.06em. Hebrew never gets letter-spacing and has no case. Computed in px (RN has
 * no `em`) from the token sizes: display-xl 40, display 28, meta 12.
 * @returns style objects to merge after the token classes; empty for Hebrew.
 */
export function useTypeTracking(): { displayXl: TextStyle; display: TextStyle; meta: TextStyle } {
  const { i18n } = useTranslation();
  // Keyed on language, not direction: the rule is about Latin letterforms.
  const latin = (i18n.resolvedLanguage ?? i18n.language) === "en";
  if (!latin) return { displayXl: {}, display: {}, meta: {} };
  return {
    displayXl: { letterSpacing: -0.01 * 40 },
    display: { letterSpacing: -0.01 * 28 },
    meta: { letterSpacing: 0.06 * 12, textTransform: "uppercase" },
  };
}

type Props = TextProps & {
  /** Token colour class, e.g. "text-ink" (default) or "text-ink-soft". */
  tone?: string;
  className?: string;
};

/** Heading level of a {@link Display}: 1 = the screen's title, 2 = a section, 3 = a sub-section. */
export type HeadingLevel = 1 | 2 | 3;

/**
 * react-native-web renders `accessibilityRole="header"` as an h1 whatever its depth, so on the web the level is
 * stated explicitly (`role="heading"` + `aria-level`). Native has no levels: it gets the plain header role.
 */
export function headingProps(level: HeadingLevel) {
  return Platform.OS === "web" ? { role: "heading" as const, "aria-level": level } : { accessibilityRole: "header" as const };
}

/**
 * The serif headline: display-xl (screen title, item name) or display (section heads). Frank Ruhl Libre 400.
 * Use this instead of `font-display` classes so the English tracking rule cannot be forgotten.
 * It is always a heading. `level` is its depth in the page outline, independent of its size: 1 for the screen
 * title (ScreenHeader sets it), 2 (default) for section heads, 3 below those. A page has one level 1.
 */
export function Display({
  size = "display",
  level = 2,
  tone = "text-ink",
  className = "",
  style,
  ...rest
}: Props & { size?: "display-xl" | "display"; level?: HeadingLevel }) {
  const tracking = useTypeTracking();
  return (
    <Text
      {...rest}
      {...headingProps(level)}
      className={`font-display ${size === "display-xl" ? "text-display-xl" : "text-display"} ${tone} ${className}`}
      style={[size === "display-xl" ? tracking.displayXl : tracking.display, style]}
    />
  );
}

/** Small label (type · colour, field labels): Plex Sans 400 12/18; uppercase and tracked in English only. */
export function Meta({ tone = "text-ink-faint", className = "", style, ...rest }: Props) {
  const tracking = useTypeTracking();
  return <Text {...rest} className={`font-body text-meta ${tone} ${className}`} style={[tracking.meta, style]} />;
}
