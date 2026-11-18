import { Tabs } from "expo-router";
import { View } from "react-native";
import { PreviewBanner } from "../../components/PreviewBanner";
import { isPreview } from "../../data/preview";
import { SceneLayout } from "../../features/shell/SceneGate";
import { ShellTabBar, useIsDesktop } from "../../features/shell/ShellTabBar";
import { colors } from "../../theme/tokens";

/**
 * The five destinations (DESIGN.md section 3 "שלד"). Declaration order is the bar order in reading direction; the
 * bar itself is custom (ShellTabBar) because it swaps between a bottom TabBar and a top TopNav by window width.
 */
export default function TabsLayout() {
  const desktop = useIsDesktop();
  return (
    <View style={{ flex: 1, backgroundColor: colors["ivory"] }}>
      <Tabs
        // don't touch / visited tabs stay mounted (state and scroll survive); SceneLayout takes the blurred ones out
        // of the web tab order. React Activity (`activityEnabled`) was tried and does nothing for a tab navigator.
        screenLayout={({ children }) => <SceneLayout>{children}</SceneLayout>}
        tabBar={(props) => <ShellTabBar {...props} />}
        screenOptions={{
          headerShown: false,
          // don't touch / DESIGN.md section 5: tab switches are instant, a cross-fade feels slow.
          animation: "none",
          // BottomTabView places a custom bar by this option of the focused screen: top nav on desktop.
          tabBarPosition: desktop ? "top" : "bottom",
          sceneStyle: { backgroundColor: colors["ivory"] },
        }}
      >
        <Tabs.Screen name="wardrobe" />
        <Tabs.Screen name="index" />
        <Tabs.Screen name="intake" />
        <Tabs.Screen name="insights" />
        <Tabs.Screen name="profile" />
      </Tabs>
      {/* On mobile the banner lives inside the tab bar, above it. */}
      {desktop && isPreview() ? <PreviewBanner /> : null}
    </View>
  );
}
