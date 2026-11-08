import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Monogram } from "../components/brand/Monogram";
import { StillLife } from "../components/brand/StillLife";
import { useDayContext } from "../data/useDayContext";
import { signInWithGoogle } from "../features/auth/signIn";
import { layout } from "../theme/tokens";

/**
 * Sign-in. One primary action, no icon (DESIGN.md section 2). Google is the only provider (PRD section 2).
 * Shown only while signed out; the root layout's route guard keeps signed-in users away from it.
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
          paddingBottom: insets.bottom + 48,
        }}
      >
        <View className="flex-row items-center justify-between">
          <Monogram />
          {/* don't touch / body font, not mono: Plex Mono has no Hebrew glyphs, so the browser substituted a
              fallback with wide gaps between words. Mono is for numbers only. */}
          {day?.hebrewDate ? <Text className="font-body text-body-sm text-ink-soft">{day.hebrewDate[locale]}</Text> : null}
        </View>
        <View className="mt-12 border-t border-hairline pt-6">
          <Text className="font-display text-display-xl text-ink">{t("app.name")}</Text>
          <Text className="mt-3 font-body text-body text-ink-soft">{t("auth.tagline")}</Text>
        </View>
        {/* The composition takes the free height and centres in it, so a tall screen has no dead band above the
            button (the "half-empty screen" complaint). */}
        <View style={{ flexGrow: 1, justifyContent: "center", paddingVertical: 32 }}>
          <StillLife />
        </View>
        <Text className="mb-3 font-body text-body-sm text-ink-soft">{t("auth.prompt")}</Text>
        {failed ? <Text className="mb-3 font-body text-body-sm text-warn">{t("auth.failed")}</Text> : null}
        <Pressable
          onPress={() => void onPress()}
          disabled={busy}
          accessibilityRole="button"
          className="items-center justify-center rounded bg-accent"
          style={{ height: 48, opacity: busy ? 0.6 : 1 }}
        >
          <Text className="font-body-semibold text-body text-accent-ink">{t("auth.google")}</Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}
