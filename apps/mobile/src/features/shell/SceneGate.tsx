import type { ReactNode } from "react";
import { Platform, View } from "react-native";
// don't touch / the tab navigator's own state, not `useIsFocused`: a tab scene also loses focus when a modal route
// (the item screen, /location, /archive) is pushed above the tabs, and hiding it then removed the whole wardrobe or
// Today screen under the item flight (verification N1, 2026-11-18). `expo-router/build/*` is a public export path of
// the package; the hook reads the nearest navigator's state from context, which inside a tab scene is the tabs'.
import { useNavigationState } from "expo-router/build/react-navigation/core/useNavigationState";

/**
 * Wraps every tab screen. On the web a tab that is not the selected one stays mounted (its state and scroll position
 * must survive) but react-native-web only marks it `aria-hidden`: its buttons and links stayed in the keyboard tab
 * order, 11 to 58 invisible stops per screen. The `data-scene-hidden` attribute is turned into `visibility: hidden` by
 * global.css, which takes the whole subtree out of the tab order and the accessibility tree while keeping layout and
 * scroll offsets (`display: none` would reset a scroll view's offset). Native: untouched, the wrapper is a plain
 * full-size View.
 * @param selected whether this scene's route is the tab navigator's active route.
 */
function Scene({ selected, children }: { selected: boolean; children: ReactNode }) {
  // A typed object spread: RN's View types have no `dataSet`, react-native-web reads it (same as focusRingProps).
  // `scene` marks every scene, so the tabs layout can find the selected one's first control (underModal.ts).
  const hidden: object = Platform.OS !== "web" ? {} : selected ? { dataSet: { scene: "" } } : { dataSet: { scene: "", sceneHidden: "" } };
  return (
    <View {...hidden} style={{ flex: 1 }}>
      {children}
    </View>
  );
}

/**
 * `screenLayout` for the (tabs) navigator. A scene is hidden only while ANOTHER tab is selected; the selected tab
 * stays painted under a modal route, whose page fades in over it (DESIGN.md section 5: "השאר fade"). What sits under
 * a modal is taken out of the tab order and the accessibility tree by the tabs layout instead (`inert`), without
 * hiding it.
 * @param routeKey the key of the tab route this scene renders (from the navigator's `screenLayout` arguments).
 */
export function SceneLayout({ routeKey, children }: { routeKey: string; children: ReactNode }) {
  const selectedKey = useNavigationState((s) => s.routes[s.index]?.key);
  return <Scene selected={selectedKey === routeKey}>{children}</Scene>;
}
