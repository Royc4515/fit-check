import { Tabs, useIsFocused } from "expo-router";
import { useRef, type ComponentRef } from "react";
import { View } from "react-native";
import { PreviewBanner } from "../../components/PreviewBanner";
import { isPreview } from "../../data/preview";
import { SceneLayout } from "../../features/shell/SceneGate";
import { ShellTabBar, useIsDesktop } from "../../features/shell/ShellTabBar";
import { underModalProps, useFocusReturnUnderModal } from "../../features/shell/underModal";
import { colors } from "../../theme/tokens";

/**
 * The five places (DESIGN.md section 3 "שלד", "שלב 5.2" item 1): wardrobe, today, add, outfits, profile. Declaration order is the bar order in reading direction; the
 * bar itself is custom (ShellTabBar) because it swaps between a bottom TabBar and a top TopNav by window width.
 */
export default function TabsLayout() {
  const desktop = useIsDesktop();
  // This layout is the root stack's (tabs) screen: unfocused exactly while a route above it (item, outfit, location,
  // archive, insights) is on top. The tabs stay painted under it (the item page fades in over them) but leave the tab
  // order and the tree.
  const covered = !useIsFocused();
  const root = useRef<ComponentRef<typeof View>>(null);
  useFocusReturnUnderModal(root, covered);
  return (
    <View ref={root} {...underModalProps(covered)} style={{ flex: 1, backgroundColor: colors["ivory"] }}>
      <Tabs
        // don't touch / visited tabs stay mounted (state and scroll survive); SceneLayout takes the ones behind another
        // selected tab out of the web tab order. React Activity (`activityEnabled`) was tried and does nothing for a
        // tab navigator.
        screenLayout={({ route, children }) => <SceneLayout routeKey={route.key}>{children}</SceneLayout>}
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
        <Tabs.Screen name="outfits" />
        <Tabs.Screen name="profile" />
      </Tabs>
      {/* On mobile the banner lives inside the tab bar, above it. */}
      {desktop && isPreview() ? <PreviewBanner /> : null}
    </View>
  );
}
