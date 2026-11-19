import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ScrollView, Text, View } from "react-native";
import { Button, ListRow, Meta, ScreenColumn, ScreenHeader, Segmented, Sheet, StatusLine } from "../../components/ui";
import { cachedPlaceName, getSavedLocation, onLocationChange, onPlaceNameChange, type SavedLocation } from "../../data/location";
import { isPreview } from "../../data/preview";
import { useArchivedCount } from "../../data/WardrobeProvider";
import { setObservesShabbat, useObservesShabbat } from "../../data/useObservance";
import { needsRestartForDirection, setLanguage, type Locale } from "../../i18n";
import { signOut } from "../auth/signOut";
import { useIsDesktop } from "../shell/ShellTabBar";

/**
 * Profile tab: where weather comes from, the app language (switched here, stored on the device), the archive, the
 * data credits and sign-out (DESIGN.md "שלב 2", "פרופיל").
 * Reads the saved location itself (device setting, no network) and refreshes when the location screen saves a new one,
 * because this tab stays mounted underneath it. The archived count comes from the shared wardrobe (it follows an
 * archive or restore made anywhere, with no query of its own).
 * Failure modes: an unreadable location falls back to the default place (getSavedLocation never throws); while the
 * wardrobe has not loaded the archive row shows no number; a failed sign-out is said inside the sheet, which stays
 * open.
 */
export function ProfileView() {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const desktop = useIsDesktop();
  const [saved, setSaved] = useState<SavedLocation | null>(null);
  const archived = useArchivedCount();
  const language: Locale = i18n.language === "en" ? "en" : "he";
  const [restart, setRestart] = useState(() => needsRestartForDirection(language));
  const [signOutOpen, setSignOutOpen] = useState(false);
  const [signOutState, setSignOutState] = useState<"idle" | "busy" | "failed">("idle");
  const preview = isPreview();

  const [currentName, setCurrentName] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    // Cache only, no network: the name is looked up by Today; this row shows what is already known for this language.
    const load = () =>
      void Promise.all([getSavedLocation(), cachedPlaceName(language)]).then(([s, name]) => {
        if (!active) return;
        setSaved(s);
        setCurrentName(name);
      });
    load();
    const off = onLocationChange(load);
    const offName = onPlaceNameChange(load);
    return () => {
      active = false;
      off();
      offName();
    };
  }, [language]);

  const currentLabel = currentName === null ? t("location.currentShort") : t("location.currentWithPlace", { place: currentName });
  const place = saved === null ? "" : saved.kind === "city" ? saved.name : saved.kind === "current" ? currentLabel : t("location.default");

  const chooseLanguage = (next: Locale) => void setLanguage(next).then(setRestart);
  // "Keeps Shabbat and holidays" (DESIGN.md "שלב 4.1" item 10): stored on the device like the language, live everywhere.
  const observes = useObservesShabbat();

  const closeSignOut = () => {
    setSignOutOpen(false);
    setSignOutState("idle");
  };
  const confirmSignOut = () => {
    setSignOutState("busy");
    // On success the route guard (signed in) or the reload (preview) takes over; this screen goes away.
    void signOut().then((r) => setSignOutState(r.ok ? "idle" : "failed"));
  };

  return (
    <View className="flex-1 bg-ivory">
      <ScrollView contentContainerStyle={{ flexGrow: 1, paddingBottom: 32 }}>
        <ScreenColumn>
          <ScreenHeader title={t("profile.title")} safeArea={!desktop} />
          <View className="mt-8 border-t border-hairline">
            <ListRow label={t("profile.location")} value={place} onPress={() => router.push("/location")} />
            <View className="border-b border-hairline py-3" style={{ gap: 8 }}>
              <Text className="font-body text-body text-ink">{t("profile.language")}</Text>
              <Segmented<Locale>
                accessibilityLabel={t("profile.language")}
                segments={[
                  { key: "he", label: t("profile.languageHe") },
                  { key: "en", label: t("profile.languageEn") },
                ]}
                value={language}
                onChange={chooseLanguage}
              />
              {restart ? <Meta style={{ textTransform: "none" }}>{t("profile.languageRestart")}</Meta> : null}
            </View>
            <View className="border-b border-hairline py-3" style={{ gap: 8 }}>
              <Text className="font-body text-body text-ink">{t("profile.observance")}</Text>
              <Segmented<"yes" | "no">
                accessibilityLabel={t("profile.observance")}
                segments={[
                  { key: "yes", label: t("profile.observanceYes") },
                  { key: "no", label: t("profile.observanceNo") },
                ]}
                value={observes ? "yes" : "no"}
                onChange={(next) => void setObservesShabbat(next === "yes")}
              />
              <Meta style={{ textTransform: "none" }}>{t("profile.observanceMeta")}</Meta>
            </View>
            <ListRow label={t("profile.archive")} value={archived === null ? undefined : String(archived)} onPress={() => router.push("/archive")} />
          </View>
          {/* flex-1 spacer: credits and sign-out sit at the bottom of the screen, not right after the rows. */}
          <View className="flex-1" style={{ minHeight: 48 }} />
          {/* Sentence with proper names, so no English uppercase from the Meta default. */}
          <Meta style={{ textTransform: "none" }}>{t("today.credits")}</Meta>
          <View className="mt-4 items-start">
            <Button variant="text" label={t("profile.signOut.button")} onPress={() => setSignOutOpen(true)} expanded={signOutOpen} />
          </View>
        </ScreenColumn>
      </ScrollView>
      <Sheet
        open={signOutOpen}
        onClose={closeSignOut}
        title={t("profile.signOut.title")}
        footer={
          <View className="flex-row" style={{ gap: 12 }}>
            <View className="flex-1">
              <Button variant="ink" fullWidth label={t("profile.signOut.confirm")} onPress={confirmSignOut} disabled={signOutState === "busy"} />
            </View>
            <View className="flex-1">
              <Button variant="outline" fullWidth label={t("profile.signOut.cancel")} onPress={closeSignOut} />
            </View>
          </View>
        }
      >
        <Text className="font-body text-body text-ink-soft">{preview ? t("profile.signOut.bodyPreview") : t("profile.signOut.body")}</Text>
        {signOutState === "failed" ? (
          <View className="mt-2">
            <StatusLine variant="error" message={t("profile.signOut.failed")} />
          </View>
        ) : null}
      </Sheet>
    </View>
  );
}
