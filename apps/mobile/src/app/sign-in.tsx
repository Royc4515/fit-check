import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Monogram } from "../components/brand/Monogram";
import { StillLife } from "../components/brand/StillLife";
import { Button, Display, StatusLine } from "../components/ui";
import { useDayContext } from "../data/useDayContext";
import { signInWithGoogle } from "../features/auth/signIn";
import { layout } from "../theme/tokens";

/**
 * Sign-in, laid out as a magazine cover (DESIGN.md section 8, Kinfolk): the app name is the one serif moment, the
 * still life is the one object, and the Google button is the screen's single primary action in the thumb zone.
 * Google is the only provider (PRD section 2). Shown only while signed out; the root layout's route guard keeps
 * signed-in users away from it. A cancelled sign-in shows nothing; only a real failure gets a message.
 */
export default function SignIn() {
  const { t, i18n } = useTranslation();
  const insets = useSafeAreaInsets();
  // The real date makes the cover read like an issue of a magazine; it needs no account (Hebcal is public).
  const day = useDayContext();
  const locale = i18n.language === "en" ? "en" : "he";
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  const onPress = async () => {
    setBusy(true);
    setFailed(false);
    const result = await signInWithGoogle();
    // `ok` navigates away (web) or flips the session guard (native); only a real failure needs a message.
    if (!result.ok && result.reason === "failed") setFailed(true);
    setBusy(false);
  };

  return (
    <ScrollView className="flex-1 bg-ivory" contentContainerStyle={{ flexGrow: 1 }}>
      {/* flexGrow keeps the button at the bottom on tall screens; short screens scroll instead of clipping it. */}
      <View
        style={{
          flexGrow: 1,
          width: "100%",
          maxWidth: layout.maxContentWidth,
          alignSelf: "center",
          paddingHorizontal: layout.gutter,
          paddingTop: insets.top + 32,
          paddingBottom: insets.bottom + 32,
        }}
      >
        <View className="flex-row items-center justify-between">
          <Monogram />
          {/* don't touch / body font, not mono: Plex Mono has no Hebrew glyphs, so the browser substituted a
              fallback with wide gaps between words. Mono is for numbers only. */}
          {day?.hebrewDate ? <Text className="font-body text-body-sm text-ink-soft">{day.hebrewDate[locale]}</Text> : null}
        </View>
        <View className="mt-12">
          <Display size="display-xl" accessibilityRole="header">
            {t("app.name")}
          </Display>
          <Text className="mt-3 font-body text-body text-ink-soft">{t("auth.tagline")}</Text>
        </View>
        {/* The composition takes the free height and centres in it, so a tall screen has no dead band above the
            button. Capped width: one object in a lot of air, not a poster. */}
        <View style={{ flexGrow: 1, justifyContent: "center", paddingVertical: 48 }}>
          <View style={{ width: "72%", alignSelf: "center" }}>
            <StillLife />
          </View>
        </View>
        <Text className="mb-3 font-body text-body-sm text-ink-soft">{t("auth.prompt")}</Text>
        {failed ? <StatusLine variant="error" message={t("auth.failed")} /> : null}
        <Button variant="primary" fullWidth label={t("auth.google")} onPress={() => void onPress()} disabled={busy} />
      </View>
    </ScrollView>
  );
}
