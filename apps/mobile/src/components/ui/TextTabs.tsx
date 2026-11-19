import { useEffect } from "react";
import { Platform, Pressable, ScrollView, Text, View } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { colors, layout, motion } from "../../theme/tokens";
import { focusRingProps, selectionHaptic, timing, webStateProps } from "./interaction";
import { useRovingGroup } from "./roving";

export type TextTab<K extends string> = { key: K; label: string };

type Props<K extends string> = {
  tabs: readonly TextTab<K>[];
  value: K;
  onChange: (key: K) => void;
  /** What the row chooses, for screen readers ("categories"). */
  accessibilityLabel: string;
  /** Start and end padding of the scrolling row, so the first tab lines up with the screen's gutter. */
  inset?: number;
  /**
   * Ids for the WAI-ARIA tabs pattern: each tab gets `<prefix>-tab-<key>` and `aria-controls` the panel
   * `<prefix>-panel` (render it with `TabPanel`). Without it the row is as before: tabs that filter what is below
   * (the wardrobe's category row), with no panel to name.
   */
  idPrefix?: string;
};

/** The DOM id of one tab of a row with `idPrefix`. */
export const tabIdOf = (idPrefix: string, key: string) => `${idPrefix}-tab-${key}`;
/** The DOM id of the panel a row with `idPrefix` controls. */
export const panelIdOf = (idPrefix: string) => `${idPrefix}-panel`;

const UNDERLINE = 2;
/**
 * Visible space between two words: the words must read as separate targets without any frame around them. It is
 * built from padding inside each tab (TAB_PAD on both sides), not from a flex gap, so the pressable box itself
 * spans the whole space and a one-letter tab is still a 44-wide target.
 */
const TAB_PAD = 12;

function TabButton<K extends string>({
  tab,
  selected,
  onPress,
  roving,
  idPrefix,
}: {
  tab: TextTab<K>;
  selected: boolean;
  onPress: () => void;
  /** Web keyboard props of the row (tabindex, arrow keys); empty on native. */
  roving: object;
  idPrefix?: string;
}) {
  // A typed object spread: RN's Pressable types have no aria-controls; react-native-web forwards it.
  const panel: { "aria-controls"?: string } = idPrefix && Platform.OS === "web" ? { "aria-controls": panelIdOf(idPrefix) } : {};
  const on = useSharedValue(selected ? 1 : 0);
  useEffect(() => {
    on.set(withTiming(selected ? 1 : 0, timing(motion.stateMs)));
  }, [on, selected]);
  const underline = useAnimatedStyle(() => ({ opacity: on.get() }));
  return (
    <Pressable
      {...focusRingProps}
      {...roving}
      {...panel}
      nativeID={idPrefix ? tabIdOf(idPrefix, tab.key) : undefined}
      onPress={onPress}
      accessibilityRole="tab"
      accessibilityLabel={tab.label}
      accessibilityState={{ selected }}
      {...webStateProps({ selected })}
      // Row, so the word's box stretches to the full 44 height; minWidth because react-native-web has no hitSlop.
      style={{ flexDirection: "row", justifyContent: "center", paddingHorizontal: TAB_PAD, minWidth: layout.hit, minHeight: layout.hit }}
    >
      {/* The underline lives on this inner box so it is as wide as the word, not as the padded pressable. */}
      <View style={{ justifyContent: "center" }}>
        <Text className={`font-body text-body-sm ${selected ? "text-ink" : "text-ink-soft"}`} numberOfLines={1}>
          {tab.label}
        </Text>
        {/* The chosen word is underlined, not filled; its last pixel lies on the row's hairline (see marginBottom). */}
        <Animated.View style={[{ position: "absolute", start: 0, end: 0, bottom: 0, height: UNDERLINE, backgroundColor: colors.ink }, underline]} />
      </View>
    </Pressable>
  );
}

/**
 * A row of words as tabs (DESIGN.md section 3 "ארון" item 2, after SSENSE and Aimé Leon Dore): body-sm, the chosen
 * one ink with a 2px underline, the rest ink-soft, all on one hairline. Unlike Segmented the tabs keep their natural
 * width and the row scrolls sideways when it does not fit. Exactly one is always chosen.
 *
 * Keyboard on web (WAI-ARIA tablist): one tab stop, arrows / Home / End move between tabs, and moving the focus
 * activates the tab (automatic activation: the grid under the tabs re-filters instantly, so there is no cost in
 * following the focus, and one key press fewer for the reader).
 */
export function TextTabs<K extends string>({ tabs, value, onChange, accessibilityLabel, inset = 0, idPrefix }: Props<K>) {
  const choose = (key: K) => {
    if (key === value) return;
    selectionHaptic();
    onChange(key);
  };
  const { itemProps } = useRovingGroup(
    tabs.length,
    tabs.findIndex((tab) => tab.key === value),
    (i) => {
      const tab = tabs[i];
      if (tab) choose(tab.key);
    }
  );
  return (
    <View className="border-b border-hairline">
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        accessibilityRole="tablist"
        accessibilityLabel={accessibilityLabel}
        // The tabs carry TAB_PAD themselves, so the row gives it back: the first word still starts at `inset`.
        contentContainerStyle={{ paddingHorizontal: Math.max(0, inset - TAB_PAD), flexGrow: 1 }}
        // don't touch / a scroll view clips its children, so the underline cannot hang below it onto the hairline
        // (as Segmented's does); instead the whole row overlaps the hairline by 1px.
        style={{ marginBottom: -1 }}
      >
        {tabs.map((tab, i) => (
          <TabButton key={tab.key} tab={tab} selected={tab.key === value} roving={itemProps(i)} idPrefix={idPrefix} onPress={() => choose(tab.key)} />
        ))}
      </ScrollView>
    </View>
  );
}
