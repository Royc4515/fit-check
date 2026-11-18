import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ScrollView, Text, View } from "react-native";
import { Button, ListRow, Meta, ScreenColumn, ScreenHeader, Segmented, Sheet, StatusLine } from "../../components/ui";
import { fetchArchivedCount } from "../../data/insights";
import { getSavedLocation, onLocationChange, type SavedLocation } from "../../data/location";
import { isPreview } from "../../data/preview";
import { needsRestartForDirection, setLanguage, type Locale } from "../../i18n";
import { signOut } from "../auth/signOut";
import { useIsDesktop } from "../shell/ShellTabBar";


/**
 * Profile tab: where weather comes from, the app language (switched here, stored on the device), the archive, the
 * data credits and sign-out (DESIGN.md "שלב 2", "פרופיל").
 * Reads the saved location itself (device setting, no network) and refreshes when the location screen saves a new one,
 * because this tab stays mounted underneath it. The archived count reloads on every focus (archiving happens
 * elsewhere).
 * Failure modes: an unreadable location falls back to the default place (getSavedLocation never throws); a failed
 * archive count shows the row without a number; a failed sign-out is said inside the sheet, which stays open.
 */
export function ProfileView() {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const desktop = useIsDesktop();
  const [saved, setSaved] = useState<SavedLocation | null>(null);
  const [archived, setArchived] = useState<number | null>(null);
  const language: Locale = i18n.language === "en" ? "en" : "he";
  const [restart, setRestart] = useState(() => needsRestartForDirection(language));
  const [signOutOpen, setSignOutOpen] = useState(false);
  const [signOutState, setSignOutState] = useState<"idle" | "busy" | "failed">("idle");
  const preview = isPreview();

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

  useFocusEffect(
    useCallback(() => {
      let active = true;
      fetchArchivedCount().then(
        (n) => active && setArchived(n),
        (error: unknown) => console.error("Archived count failed", error)
      );
      return () => {
        active = false;
      };
    }, [])
  );

  const place =
    saved === null ? "" : saved.kind === "city" ? saved.name : saved.kind === "current" ? t("location.currentShort") : t("location.default");

  const chooseLanguage = (next: Locale) => void setLanguage(next).then(setRestart);

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
            {/* /archive belongs to the wardrobe work and lands with it; until that merge this link is a 404. */}
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
