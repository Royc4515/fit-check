import { useTranslation } from "react-i18next";
import { Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { WardrobeState } from "../data/WardrobeProvider";
import { layout } from "../theme/tokens";

/**
 * What a screen shows until the wardrobe is ready. DESIGN.md section 1: loading is a quiet empty page plus one
 * line of text; no spinner, no skeleton. Error adds the one action that can fix it.
 */
export function WardrobeGate({ state }: { state: Exclude<WardrobeState, { status: "ready" }> }) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  return (
    <View className="flex-1 bg-ivory" style={{ paddingTop: insets.top + 32, paddingHorizontal: layout.gutter }}>
      <Text className="font-body text-body text-ink-soft">
        {state.status === "loading" ? t("common.loading") : t("common.loadFailed")}
      </Text>
      {state.status === "error" ? (
        <Pressable onPress={state.reload} accessibilityRole="button" className="mt-4 self-start">
          <View className="border-b border-hairline pb-1">
            <Text className="font-body text-body-sm text-ink">{t("common.retry")}</Text>
          </View>
        </Pressable>
      ) : null}
    </View>
  );
}
