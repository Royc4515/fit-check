import { useIsFocused } from "expo-router";
import type { ReactNode } from "react";
import { Platform, View } from "react-native";

/**
 * Wraps every tab screen. On the web a blurred tab stays mounted (its state and scroll position must survive) but
 * react-native-web only marks it `aria-hidden`: its buttons and links stayed in the keyboard tab order, 11 to 58
 * invisible stops per screen. The `data-scene-hidden` attribute is turned into `visibility: hidden` by global.css,
 * which takes the whole subtree out of the tab order and the accessibility tree while keeping layout and scroll
 * offsets (`display: none` would reset a scroll view's offset). Native: untouched, the wrapper is a plain
 * full-size View.
 * @param focused whether the tab is the one on screen.
 */
function Scene({ focused, children }: { focused: boolean; children: ReactNode }) {
  // A typed object spread: RN's View types have no `dataSet`, react-native-web reads it (same as focusRingProps).
  const hidden: object = Platform.OS === "web" && !focused ? { dataSet: { sceneHidden: "" } } : {};
  return (
    <View {...hidden} style={{ flex: 1 }}>
      {children}
    </View>
  );
}

/** `screenLayout` for the (tabs) navigator: a component, so that the focus hook has a screen to read. */
export function SceneLayout({ children }: { children: ReactNode }) {
  const focused = useIsFocused();
  return <Scene focused={focused}>{children}</Scene>;
}
