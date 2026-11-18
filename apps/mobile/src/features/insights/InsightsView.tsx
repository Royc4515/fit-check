import { useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { ScrollView, View } from "react-native";
import { EmptyState, ScreenHeader } from "../../components/ui";
import { layout } from "../../theme/tokens";
import { useIsDesktop } from "../shell/ShellTabBar";

/**
 * Insights tab. Outfit history and spending do not exist as data yet, so this is the designed empty state with the
 * one action that gets the user somewhere useful (the wardrobe). Replaced by the real screen in a later task.
 */
export function InsightsView() {
  const { t } = useTranslation();
  const router = useRouter();
  const desktop = useIsDesktop();
  return (
    <View className="flex-1 bg-ivory">
      <ScrollView
        contentContainerStyle={{
          width: "100%",
          maxWidth: layout.maxContentWidth,
          alignSelf: "center",
          paddingHorizontal: layout.gutter,
          paddingBottom: 32,
        }}
      >
        <ScreenHeader title={t("insights.title")} safeArea={!desktop} />
        <EmptyState
          title={t("insights.empty.title")}
          body={t("insights.empty.body")}
          action={{ label: t("insights.empty.action"), onPress: () => router.navigate("/wardrobe") }}
        />
      </ScrollView>
    </View>
  );
}
