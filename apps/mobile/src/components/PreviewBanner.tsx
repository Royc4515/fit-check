import { useTranslation } from "react-i18next";
import { Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { layout } from "../theme/tokens";

/**
 * TEMPORARY: the one line that says the design preview is view-only (data/preview.ts). Plain meta text over a
 * hairline, no badge and no colour block (DESIGN.md section 1), so it reads as part of the page, not as an alert.
 * The root layout puts it under the screens, in the flow: on top it would shift every screen down and throw off
 * the item flight, which measures cells in window coordinates.
 * `safeArea` is off when the banner sits above the tab bar, which already pads the bottom inset.
 */
export function PreviewBanner({ safeArea = true }: { safeArea?: boolean }) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  return (
    <View
      className="border-t border-hairline bg-ivory pt-1"
      // Above the tab bar, 8px extra keeps clear of the Add square, which rises into this strip.
      style={{ paddingBottom: (safeArea ? insets.bottom : 8) + 4, paddingHorizontal: layout.gutter }}
      accessibilityRole="text"
    >
      <Text className="text-center font-body text-meta text-ink-soft">{t("preview.banner")}</Text>
    </View>
  );
}
