import "../../global.css";
import "../i18n";
import { Stack } from "expo-router";
import { useEffect, useState } from "react";
import { StatusBar } from "expo-status-bar";
import { View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { colors } from "../theme/tokens";
import { useAppFonts } from "../theme/fonts";
import { isRtl } from "../i18n";

// ViewProps has no `dir` in RN's types, but react-native-web reads it. Spreading a typed object keeps this
// free of casts; the excess-property check does not apply to JSX spreads.
const directionProps = { dir: isRtl() ? "rtl" : "ltr" };

export default function RootLayout() {
  const fontsLoaded = useAppFonts();
  // don't touch / render nothing until mounted. The web export is pre-rendered on a server whose locale is
  // not the user's, and React does not patch attributes (`dir`, inline styles) when hydrating, so SSR output
  // silently won in the wrong language/width. Locale and window size are client facts; skip server content.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  // Quiet empty state while fonts load: no spinner, no skeleton (DESIGN.md section 1).
  if (!fontsLoaded || !mounted) return <View style={{ flex: 1, backgroundColor: colors["ivory"] }} />;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      {/* don't touch / `dir` is what makes react-native-web resolve start/end/marginStart for RTL. Setting
          document.dir alone (see i18n/index.ts) flips the flex rows but leaves logical props on the LTR side,
          which shifted the outfit composition 8px out of its gutter in Hebrew. Harmless on native. */}
      <View {...directionProps} style={{ flex: 1 }}>
        <StatusBar style="dark" />
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: colors["ivory"] },
          }}
        />
      </View>
    </GestureHandlerRootView>
  );
}
