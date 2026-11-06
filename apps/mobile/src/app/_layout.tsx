import "../../global.css";
import "../i18n";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { colors } from "../theme/tokens";
import { useAppFonts } from "../theme/fonts";

export default function RootLayout() {
  const fontsLoaded = useAppFonts();
  // Quiet empty state while fonts load: no spinner, no skeleton (DESIGN.md section 1).
  if (!fontsLoaded) return <View style={{ flex: 1, backgroundColor: colors["ivory"] }} />;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <StatusBar style="dark" />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: colors["ivory"] },
        }}
      />
    </GestureHandlerRootView>
  );
}
