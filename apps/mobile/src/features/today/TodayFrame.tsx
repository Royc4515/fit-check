import { useState } from "react";
import { ScrollView, View, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Reveal } from "../../components/editorial/Reveal";
import { ACTION_BAR_HEIGHT, FLAT_LAY_ASPECT, FlatLayPlaceholder, TabPanel } from "../../components/ui";
import { fitFlatLay } from "../../components/ui/flatLayFit";
import type { DayContext } from "../../data/dayContext";
import { layout } from "../../theme/tokens";
import { DayTabs } from "./DayTabs";
import {
  DAY_TABS,
  DESKTOP_GAP,
  DESKTOP_GUTTER,
  DESKTOP_HERO_MAX,
  DESKTOP_HERO_PAD,
  DESKTOP_TABS_GAP,
  MOBILE_HERO_GAP,
  MOBILE_TOP,
  UNDER_BAR,
} from "./frameLayout";
import { Masthead, PlannedForecastLine } from "./Masthead";

/**
 * Today's frame (DESIGN.md section 3 "היום" item 1, "המסגרת קודם"): what Today draws before its first outfit, from
 * the device's own data, never waiting on an outside service. The masthead (title, dates, the times row, the weather
 * and the place), the day tabs once the planned days and the day's records are known, and the hero's place at the size
 * the outfit will take (a floating bar's height reserved under it), with `waiting` in words on it. Every box stands
 * where TodayView draws it, so when the outfit arrives only the hero area changes.
 *
 * @param tabs - the selected date and the change handler; null draws no tabs (no planned day, or not decided yet).
 * @param weatherSettled - the forecast is no longer waited for. @param calendarSettled - the calendar likewise.
 */
export function TodayFrame({
  day,
  tabs,
  waiting,
  weatherSettled,
  calendarSettled,
}: {
  day: DayContext;
  tabs: { value: string; onChange: (date: string) => void } | null;
  waiting: string;
  weatherSettled: boolean;
  calendarSettled: boolean;
}) {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const desktop = width >= layout.desktopMin;
  const [viewportHeight, setViewportHeight] = useState(0);
  const [mastheadHeight, setMastheadHeight] = useState(0);
  const [aboveHeroHeight, setAboveHeroHeight] = useState<number | null>(null);
  const [tabsHeight, setTabsHeight] = useState(0);
  const [desktopTabsHeight, setDesktopTabsHeight] = useState(0);
  const hasTabs = tabs !== null && day.chain.length > 0;
  const selected = hasTabs ? tabs.value : day.date;
  const planned = day.chain.find((d) => d.date === selected) ?? null;

  const masthead = <Masthead day={day} weatherSettled={weatherSettled} calendarSettled={calendarSettled} />;
  const dayTabs = hasTabs ? (
    <DayTabs day={day} value={selected} onChange={tabs.onChange} inset={desktop ? 0 : layout.gutter} idPrefix={DAY_TABS} />
  ) : null;

  if (desktop) {
    const tabsSpace = hasTabs ? desktopTabsHeight + DESKTOP_TABS_GAP : 0;
    const heroMax =
      viewportHeight > 0 ? Math.min(DESKTOP_HERO_MAX, (viewportHeight - 2 * DESKTOP_HERO_PAD - tabsSpace) / FLAT_LAY_ASPECT) : DESKTOP_HERO_MAX;
    return (
      <View className="flex-1 bg-ivory" onLayout={(e) => setViewportHeight(e.nativeEvent.layout.height)}>
        <ScrollView contentContainerStyle={{ paddingTop: insets.top + DESKTOP_HERO_PAD, paddingBottom: 64 + insets.bottom }}>
          <View
            className="flex-row items-start"
            style={{ width: "100%", maxWidth: layout.maxContentWidthWide, alignSelf: "center", paddingHorizontal: DESKTOP_GUTTER, gap: DESKTOP_GAP }}
          >
            <View style={{ flex: 1, maxWidth: heroMax }}>
              {dayTabs ? (
                <View style={{ marginBottom: DESKTOP_TABS_GAP }} onLayout={(e) => setDesktopTabsHeight(e.nativeEvent.layout.height)}>
                  {dayTabs}
                </View>
              ) : null}
              <TabPanel idPrefix={DAY_TABS} selectedKey={selected} active={hasTabs}>
                <Reveal index={1}>
                  <FlatLayPlaceholder radius="md" label={waiting} />
                </Reveal>
              </TabPanel>
            </View>
            <View style={{ flex: 1 }}>
              <Reveal index={0}>{masthead}</Reveal>
              {planned ? (
                <View className="mt-6">
                  <PlannedForecastLine planned={planned} />
                </View>
              ) : null}
            </View>
          </View>
        </ScrollView>
      </View>
    );
  }

  const measured = viewportHeight > 0 && mastheadHeight > 0 && aboveHeroHeight !== null && (!hasTabs || tabsHeight > 0);
  const heroTop = insets.top + MOBILE_TOP + mastheadHeight + (hasTabs ? tabsHeight : 0) + (aboveHeroHeight ?? 0) + MOBILE_HERO_GAP;
  // The bar arrives with the outfit: its height is kept now, so the flat-lay lands in exactly this box.
  const { card, cardWidth, maxHeight } = fitFlatLay({ measured, desktop, width, viewportHeight, heroTop, bottomReserved: ACTION_BAR_HEIGHT });
  return (
    <View className="flex-1 bg-ivory" onLayout={(e) => setViewportHeight(e.nativeEvent.layout.height)}>
      <View style={{ flex: 1, width: "100%", maxWidth: layout.maxContentWidth, alignSelf: "center" }}>
        <ScrollView contentContainerStyle={{ paddingTop: insets.top + MOBILE_TOP, paddingBottom: UNDER_BAR }}>
          <Reveal index={0}>
            <View className="px-5" onLayout={(e) => setMastheadHeight(e.nativeEvent.layout.height)}>
              {masthead}
            </View>
          </Reveal>
          {dayTabs ? (
            <Reveal index={1}>
              <View onLayout={(e) => setTabsHeight(e.nativeEvent.layout.height)}>
                <View className="mt-6">{dayTabs}</View>
              </View>
            </Reveal>
          ) : null}
          <TabPanel idPrefix={DAY_TABS} selectedKey={selected} active={hasTabs}>
            <Reveal index={1}>
              <View onLayout={(e) => setAboveHeroHeight(e.nativeEvent.layout.height)}>
                {hasTabs ? (
                  <View className="mt-4 px-5">
                    <PlannedForecastLine planned={planned} />
                  </View>
                ) : null}
              </View>
              <View style={{ marginTop: MOBILE_HERO_GAP, ...(cardWidth ? { width: cardWidth, alignSelf: "center" as const } : null) }}>
                <FlatLayPlaceholder maxHeight={maxHeight} radius={card ? "md" : "none"} label={waiting} />
              </View>
            </Reveal>
          </TabPanel>
        </ScrollView>
      </View>
    </View>
  );
}
