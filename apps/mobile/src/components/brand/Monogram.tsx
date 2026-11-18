import { useTranslation } from "react-i18next";
import { Text, View } from "react-native";

// Type-scale sizes only (DESIGN.md section 2); static strings so NativeWind can see the classes.
const MARK_SIZES = [
  { px: 12, className: "text-meta" },
  { px: 16, className: "text-num" },
  { px: 20, className: "text-title" },
] as const;

/**
 * The FC monogram: Frank Ruhl Libre inside a hairline square, the same mark as the app icon and splash
 * (assets/icon.png). Ink on ivory only; it is a signature, not decoration, so it appears once per screen at most.
 */
export function Monogram({ size = 44 }: { size?: number }) {
  const { t } = useTranslation();
  // The mark wants to be 40% of its box; the scale has no such size, so take the nearest token (44 -> 16, 32 -> 12).
  const target = size * 0.4;
  const mark = MARK_SIZES.reduce((best, m) => (Math.abs(m.px - target) < Math.abs(best.px - target) ? m : best));
  return (
    <View
      accessibilityRole="image"
      accessibilityLabel={t("app.name")}
      className="items-center justify-center border-ink"
      style={{ width: size, height: size, borderWidth: Math.max(1, size / 44) }}
    >
      <Text className={`font-display text-ink ${mark.className}`} style={{ letterSpacing: -0.3 }}>
        FC
      </Text>
    </View>
  );
}
