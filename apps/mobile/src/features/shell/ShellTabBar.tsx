import type { BottomTabBarProps } from "expo-router/js-tabs";
import { useTranslation } from "react-i18next";
import { Text, View, useWindowDimensions } from "react-native";
import { PreviewBanner } from "../../components/PreviewBanner";
import { TabBar, TopNav, type NavItem } from "../../components/ui";
import { isPreview } from "../../data/preview";
import { layout } from "../../theme/tokens";

type NavKey = "wardrobe" | "today" | "outfits" | "profile";
/** `add` is the active key on the Add route; no item carries it, so no destination shows as selected there. */
type Key = NavKey | "add";

/** Route file name (inside `(tabs)`) for each destination. `today` is the group's index route. */
const ROUTE_OF: Record<NavKey, string> = { wardrobe: "wardrobe", today: "index", outfits: "outfits", profile: "profile" };
const ADD_ROUTE = "intake";

const ITEMS: readonly { key: NavKey; icon: NavItem["icon"] }[] = [
  { key: "wardrobe", icon: "checkroom" },
  { key: "today", icon: "today" },
  { key: "outfits", icon: "style" },
  { key: "profile", icon: "person" },
];

/** True from the desktop breakpoint up; the one place the shell decides between bottom bar and top nav. */
export function useIsDesktop(): boolean {
  return useWindowDimensions().width >= layout.desktopMin;
}

/**
 * The tab bar for the (tabs) navigator: the library TabBar below 900px, the library TopNav from 900px up. Reads the
 * window width itself, so resizing the browser swaps them live. On mobile the temporary preview banner is stacked
 * directly above the bar (on desktop the layout puts it under the content).
 * Failure modes: a route missing from the navigator state is ignored, so the bar never throws.
 */
export function ShellTabBar({ state, navigateToTab }: BottomTabBarProps) {
  const { t } = useTranslation();
  const desktop = useIsDesktop();
  const focused = state.routes[state.index]?.name;
  // The Add route has no item in `items`, so on /intake no destination is marked selected.
  const activeKey: Key = ITEMS.find((i) => ROUTE_OF[i.key] === focused)?.key ?? "add";
  const go = (name: string) => {
    const route = state.routes.find((r) => r.name === name);
    if (route) navigateToTab(route.key);
  };
  const items: NavItem<Key>[] = ITEMS.map((i) => ({ key: i.key, icon: i.icon, label: t(`nav.${i.key}`) }));
  const add = { label: t("nav.add"), onPress: () => go(ADD_ROUTE) };
  const onSelect = (key: Key) => go(key === "add" ? ADD_ROUTE : ROUTE_OF[key]);

  if (desktop) {
    return (
      <TopNav
        items={items}
        activeKey={activeKey}
        onSelect={onSelect}
        add={add}
        brand={<Text className="font-display text-display text-ink">{t("app.name")}</Text>}
      />
    );
  }
  return (
    <View>
      {isPreview() ? <PreviewBanner safeArea={false} /> : null}
      <TabBar items={items} activeKey={activeKey} onSelect={onSelect} add={add} />
    </View>
  );
}
