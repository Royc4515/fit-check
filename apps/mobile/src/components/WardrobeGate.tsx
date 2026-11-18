import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { WardrobeState } from "../data/WardrobeProvider";
import { EmptyState, Meta, ScreenColumn } from "./ui";

/**
 * What a screen shows until the wardrobe is ready. DESIGN.md section 1: loading is an empty ivory page with one calm
 * line low on it; no spinner, no skeleton (a layout hint would promise a screen shape that is not there yet).
 * Error is an EmptyState with the one action that can fix it.
 */
export function WardrobeGate({ state }: { state: Exclude<WardrobeState, { status: "ready" }> }) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  if (state.status === "loading") {
    return (
      <View className="flex-1 items-center justify-end bg-ivory" style={{ paddingBottom: insets.bottom + 96 }}>
        {/* Sentence-like text, so no English uppercase from the Meta default. */}
        <Meta accessibilityLiveRegion="polite" style={{ textTransform: "none" }}>
          {t("common.loading")}
        </Meta>
      </View>
    );
  }
  return (
    <View className="flex-1 bg-ivory" style={{ paddingTop: insets.top }}>
      <ScreenColumn>
        <EmptyState title={t("common.loadFailed")} body={t("common.loadFailedBody")} action={{ label: t("common.retry"), onPress: state.reload }} />
      </ScreenColumn>
    </View>
  );
}
