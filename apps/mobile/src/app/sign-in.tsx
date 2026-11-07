import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { signInWithGoogle } from "../features/auth/signIn";
import { layout } from "../theme/tokens";

/**
 * Sign-in. One primary action, no icon (DESIGN.md section 2). Google is the only provider (PRD section 2).
 * Shown only while signed out; the root layout's route guard keeps signed-in users away from it.
 */
export default function SignIn() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
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
    <View className="flex-1 bg-ivory">
      <View
        style={{
          flex: 1,
          width: "100%",
          maxWidth: layout.maxContentWidth,
          alignSelf: "center",
          paddingHorizontal: layout.gutter,
          paddingTop: insets.top + 96,
          paddingBottom: insets.bottom + 48,
        }}
      >
        <Text className="font-display text-display-xl text-ink">{t("app.name")}</Text>
        <Text className="mt-3 font-body text-body text-ink-soft">{t("auth.prompt")}</Text>
        <View style={{ flex: 1 }} />
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
    </View>
  );
}
