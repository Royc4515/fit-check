import { useEffect } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { colors, layout, motion } from "../../theme/tokens";
import { focusRingProps, selectionHaptic, timing } from "./interaction";

export type TextTab<K extends string> = { key: K; label: string };

type Props<K extends string> = {
  tabs: readonly TextTab<K>[];
  value: K;
  onChange: (key: K) => void;
  /** What the row chooses, for screen readers ("categories"). */
  accessibilityLabel: string;
  /** Start and end padding of the scrolling row, so the first tab lines up with the screen's gutter. */
  inset?: number;
};

const UNDERLINE = 2;
/** Between two tabs: the words must read as separate targets without any frame around them. */
const TAB_GAP = 24;

function TabButton<K extends string>({ tab, selected, onPress }: { tab: TextTab<K>; selected: boolean; onPress: () => void }) {
  const on = useSharedValue(selected ? 1 : 0);
  useEffect(() => {
    on.set(withTiming(selected ? 1 : 0, timing(motion.stateMs)));
  }, [on, selected]);
  const underline = useAnimatedStyle(() => ({ opacity: on.get() }));
  return (
    <Pressable
      {...focusRingProps}
      onPress={onPress}
      accessibilityRole="tab"
      accessibilityLabel={tab.label}
      accessibilityState={{ selected }}
      className="justify-center"
      style={{ minHeight: layout.hit }}
    >
      <Text className={`font-body text-body-sm ${selected ? "text-ink" : "text-ink-soft"}`} numberOfLines={1}>
        {tab.label}
      </Text>
      {/* The chosen word is underlined, not filled; its last pixel lies on the row's hairline (see marginBottom). */}
      <Animated.View style={[{ position: "absolute", start: 0, end: 0, bottom: 0, height: UNDERLINE, backgroundColor: colors.ink }, underline]} />
    </Pressable>
  );
}

/**
 * A row of words as tabs (DESIGN.md section 3 "ארון" item 2, after SSENSE and Aimé Leon Dore): body-sm, the chosen
 * one ink with a 2px underline, the rest ink-soft, all on one hairline. Unlike Segmented the tabs keep their natural
 * width and the row scrolls sideways when it does not fit. Exactly one is always chosen.
 */
export function TextTabs<K extends string>({ tabs, value, onChange, accessibilityLabel, inset = 0 }: Props<K>) {
  return (
    <View className="border-b border-hairline">
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        accessibilityRole="tablist"
        accessibilityLabel={accessibilityLabel}
        contentContainerStyle={{ paddingHorizontal: inset, gap: TAB_GAP, flexGrow: 1 }}
        // don't touch / a scroll view clips its children, so the underline cannot hang below it onto the hairline
        // (as Segmented's does); instead the whole row overlaps the hairline by 1px.
        style={{ marginBottom: -1 }}
      >
        {tabs.map((tab) => (
          <TabButton
            key={tab.key}
            tab={tab}
            selected={tab.key === value}
            onPress={() => {
              if (tab.key === value) return;
              selectionHaptic();
              onChange(tab.key);
            }}
          />
        ))}
      </ScrollView>
    </View>
  );
}
