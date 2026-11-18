import { Pressable, Text, View } from "react-native";
import Animated from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors, layout } from "../../theme/tokens";
import { Icon, type IconName } from "./Icon";
import { focusRingProps, selectionHaptic, usePressFeedback, webStateProps } from "./interaction";

export type NavItem<K extends string = string> = { key: K; label: string; icon: IconName };

export type NavProps<K extends string> = {
  /** The four destinations, in reading order; the Add action goes between the 2nd and 3rd on mobile. */
  items: readonly NavItem<K>[];
  activeKey: K;
  onSelect: (key: K) => void;
  /** The centre "add" action. Its label is visible on desktop and read by screen readers on mobile. */
  add: { label: string; onPress: () => void };
};

const INDICATOR = 2;
// DESIGN.md section 3: the Add square sits 8 above the bar's top line.
const ADD_RAISE = 8;

function Tab<K extends string>({ item, active, onPress }: { item: NavItem<K>; active: boolean; onPress: () => void }) {
  return (
    <Pressable
      {...focusRingProps}
      onPress={onPress}
      accessibilityRole="tab"
      accessibilityLabel={item.label}
      accessibilityState={{ selected: active }}
      {...webStateProps({ selected: active })}
      className="flex-1 items-center pt-1"
      style={{ height: layout.tabBarHeight }}
    >
      {/* Selected = ink plus a 2px line above the icon: a mark, not only a colour. Reserved when idle so nothing moves. */}
      <View style={{ width: 24, height: INDICATOR, backgroundColor: active ? colors.ink : colors.transparent }} />
      <View className="mt-1">
        <Icon name={item.icon} size={24} color={active ? "ink" : "ink-soft"} />
      </View>
      {/* num-sm size; body family, because Plex Mono has no Hebrew glyphs (see design questions in CHANGELOG). */}
      <Text className={`font-body text-num-sm ${active ? "text-ink" : "text-ink-soft"}`} numberOfLines={1}>
        {item.label}
      </Text>
    </Pressable>
  );
}

function AddSquare({ label, onPress }: { label: string; onPress: () => void }) {
  const { onPressIn, onPressOut, pressStyle } = usePressFeedback();
  return (
    <View className="flex-1 items-center" style={{ height: layout.tabBarHeight }}>
      <Pressable
        {...focusRingProps}
        onPress={onPress}
        onPressIn={onPressIn}
        onPressOut={onPressOut}
        accessibilityRole="button"
        accessibilityLabel={label}
        style={{ marginTop: -ADD_RAISE }}
      >
        <Animated.View style={pressStyle}>
          <View className="items-center justify-center rounded-lg bg-ink" style={{ width: layout.control, height: layout.control }}>
            <Icon name="add" size={24} color="ivory" />
          </View>
        </Animated.View>
      </Pressable>
    </View>
  );
}

/**
 * Mobile tab bar (DESIGN.md section 3 "שלד", below 900px): 56 + safe area, ivory-deep, hairline on top, no shadow.
 * Five slots: two destinations, the raised ink Add square, two destinations. Order follows the layout direction,
 * so in Hebrew the first item sits on the right. Presentational: the router wiring belongs to the shell task.
 */
export function TabBar<K extends string>({ items, activeKey, onSelect, add }: NavProps<K>) {
  const insets = useSafeAreaInsets();
  const half = Math.ceil(items.length / 2);
  const select = (key: K) => {
    // Re-selecting the current tab is a no-op here; scroll-to-top is the screen's business.
    if (key !== activeKey) selectionHaptic();
    onSelect(key);
  };
  const tab = (item: NavItem<K>) => <Tab key={item.key} item={item} active={item.key === activeKey} onPress={() => select(item.key)} />;
  return (
    <View accessibilityRole="tablist" className="flex-row border-t border-hairline bg-ivory-deep" style={{ paddingBottom: insets.bottom }}>
      {items.slice(0, half).map(tab)}
      <AddSquare label={add.label} onPress={add.onPress} />
      {items.slice(half).map(tab)}
    </View>
  );
}
