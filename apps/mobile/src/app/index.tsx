import { useTranslation } from "react-i18next";
import { Text, View } from "react-native";

/**
 * Placeholder route. Session 1 of Claude Code replaces this with the "Today" screen
 * per DESIGN.md section 3; nothing here is meant to survive that.
 */
export default function Index() {
  const { t } = useTranslation();
  return (
    <View className="flex-1 bg-ivory px-5 pt-16">
      <Text className="font-display text-display-xl text-ink">{t("today.title")}</Text>
      <Text className="mt-3 font-body text-body text-ink-soft">{t("today.empty")}</Text>
    </View>
  );
}
