import { useRouter } from "expo-router";
import type { BottomTabBarProps } from "expo-router/js-tabs";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Text, View, useWindowDimensions } from "react-native";
import { PreviewBanner } from "../../components/PreviewBanner";
import { ListRow, Sheet, TabBar, TopNav, type NavItem } from "../../components/ui";
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
 * The centre "+" (and the desktop "הוספה") opens a sheet with two rows (DESIGN.md "שלב 5.2" item 2): "בגד חדש", the
 * add-garment tab, and "לוק חדש", the build screen. Escape, the scrim or `close` close it and focus returns to the
 * "+" (the sheet's own focus return); a row closes it and goes.
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
  const router = useRouter();
  const [addOpen, setAddOpen] = useState(false);
  const items: NavItem<Key>[] = ITEMS.map((i) => ({ key: i.key, icon: i.icon, label: t(`nav.${i.key}`) }));
  const add = { label: t("nav.add"), onPress: () => setAddOpen(true) };
  const onSelect = (key: Key) => go(key === "add" ? ADD_ROUTE : ROUTE_OF[key]);

  const addSheet = (
    <Sheet open={addOpen} onClose={() => setAddOpen(false)} title={t("add.title")}>
      <View className="border-t border-hairline">
        <ListRow
          label={t("add.garment")}
          onPress={() => {
            setAddOpen(false);
            go(ADD_ROUTE);
          }}
        />
        <ListRow
          label={t("add.outfit")}
          onPress={() => {
            setAddOpen(false);
            router.push("/outfit/new");
          }}
        />
      </View>
    </Sheet>
  );

  if (desktop) {
    return (
      <>
        <TopNav
          items={items}
          activeKey={activeKey}
          onSelect={onSelect}
          add={add}
          brand={<Text className="font-display text-display text-ink">{t("app.name")}</Text>}
        />
        {addSheet}
      </>
    );
  }
  return (
    <View>
      {isPreview() ? <PreviewBanner safeArea={false} /> : null}
      <TabBar items={items} activeKey={activeKey} onSelect={onSelect} add={add} />
      {addSheet}
    </View>
  );
}
