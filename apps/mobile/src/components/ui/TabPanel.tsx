import type { ReactNode } from "react";
import { Platform, View } from "react-native";
import { panelIdOf, tabIdOf } from "./TextTabs";

/**
 * The content a `TextTabs` row with an `idPrefix` controls (WAI-ARIA tabs pattern): on web a `tabpanel` labelled by
 * the selected tab, which in turn names this panel in `aria-controls`. Inactive (no tabs on screen), it adds nothing
 * to the tree, so a screen without tabs renders exactly as before.
 */
export function TabPanel({ idPrefix, selectedKey, active = true, children }: { idPrefix: string; selectedKey: string; active?: boolean; children: ReactNode }) {
  if (!active) return <>{children}</>;
  // Web only: react-native-web turns these into the panel's role and label; native has no tabpanel to announce.
  const web: { role?: "tabpanel"; "aria-labelledby"?: string } = Platform.OS === "web" ? { role: "tabpanel", "aria-labelledby": tabIdOf(idPrefix, selectedKey) } : {};
  return (
    <View nativeID={panelIdOf(idPrefix)} {...web}>
      {children}
    </View>
  );
}
