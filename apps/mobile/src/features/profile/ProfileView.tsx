import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ScrollView, View } from "react-native";
import { ListRow, Meta, ScreenHeader } from "../../components/ui";
import { getSavedLocation, onLocationChange, type SavedLocation } from "../../data/location";
import { layout } from "../../theme/tokens";
import { useIsDesktop } from "../shell/ShellTabBar";

/**
 * Profile tab: where weather comes from, the active language (read-only until switching is built), and the data
 * credits. Reads the saved location itself (device setting, no network) and refreshes when the location screen
 * saves a new one, because this tab stays mounted underneath it.
 * Failure modes: an unreadable setting falls back to the default place (getSavedLocation never throws).
 */
export function ProfileView() {
  const { t } = useTranslation();
  const router = useRouter();
  const desktop = useIsDesktop();
  const [saved, setSaved] = useState<SavedLocation | null>(null);

  useEffect(() => {
    let active = true;
    const load = () => void getSavedLocation().then((s) => active && setSaved(s));
    load();
    const off = onLocationChange(load);
    return () => {
      active = false;
      off();
    };
  }, []);

  const place =
    saved === null ? "" : saved.kind === "city" ? saved.name : saved.kind === "current" ? t("location.currentShort") : t("location.default");

  return (
    <View className="flex-1 bg-ivory">
      <ScrollView
        contentContainerStyle={{
          flexGrow: 1,
          width: "100%",
          maxWidth: layout.maxContentWidth,
          alignSelf: "center",
          paddingHorizontal: layout.gutter,
          // The tab bar below already owns the bottom safe area.
          paddingBottom: 32,
        }}
      >
        <ScreenHeader title={t("profile.title")} safeArea={!desktop} />
        <View className="mt-8 border-t border-hairline">
          <ListRow label={t("profile.location")} value={place} onPress={() => router.push("/location")} />
          <ListRow label={t("profile.language")} value={t("profile.languageValue")} />
        </View>
        {/* flex-1 spacer: the credits sit at the bottom of the screen, not right after the rows. */}
        <View className="flex-1" style={{ minHeight: 48 }} />
        {/* Sentence with proper names, so no English uppercase from the Meta default. */}
        <Meta style={{ textTransform: "none" }}>{t("today.credits")}</Meta>
      </ScrollView>
    </View>
  );
}
