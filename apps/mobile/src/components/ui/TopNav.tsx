import type { ReactNode } from "react";
import { Pressable, Text, View } from "react-native";
import { colors, layout } from "../../theme/tokens";
import { Button } from "./Button";
import { focusRingProps, webStateProps } from "./interaction";
import type { NavProps } from "./TabBar";

const INDICATOR = 2;
/** Half of the 32 visible space between two destinations. */
const TAB_PAD = 16;

/**
 * Desktop navigation (DESIGN.md section 3 "שלד", 900px and up): a thin 64 bar on ivory with a hairline below. Brand
 * mark at the start, the destinations as body-sm text in the middle (selected = ink with a 2px underline), Add as
 * an ink button at the end. Same props as TabBar plus the brand, so the shell can swap one for the other by width.
 */
export function TopNav<K extends string>({ items, activeKey, onSelect, add, brand }: NavProps<K> & { brand: ReactNode }) {
  return (
    <View className="border-b border-hairline bg-ivory">
      <View
        className="flex-row items-center px-5"
        style={{ height: layout.topNavHeight, width: "100%", maxWidth: layout.maxContentWidthWide, alignSelf: "center" }}
      >
        <View className="flex-1 items-start">{brand}</View>
        <View accessibilityRole="tablist" className="flex-row">
          {items.map((item) => {
            const active = item.key === activeKey;
            return (
              <Pressable
                {...focusRingProps}
                key={item.key}
                onPress={() => onSelect(item.key)}
                accessibilityRole="tab"
                accessibilityLabel={item.label}
                accessibilityState={{ selected: active }}
                {...webStateProps({ selected: active })}
                // The 32 between two words is padding inside each tab (16 + 16), not a gap, so the 64-high box is
                // also at least 44 wide for a short word. Only the pressable gets it: the indicator stays word-wide.
                style={{ height: layout.topNavHeight, justifyContent: "center", paddingHorizontal: TAB_PAD, minWidth: layout.hit }}
              >
                <View style={{ borderBottomWidth: INDICATOR, borderBottomColor: active ? colors.ink : colors.transparent }} className="pb-1">
                  <Text className={`font-body text-body-sm ${active ? "text-ink" : "text-ink-soft"}`}>{item.label}</Text>
                </View>
              </Pressable>
            );
          })}
        </View>
        <View className="flex-1 items-end">
          {/* Own box: Button aligns itself to the start by default, which would pull it into the destinations. */}
          <View>
            <Button variant="ink" icon="add" label={add.label} onPress={add.onPress} />
          </View>
        </View>
      </View>
    </View>
  );
}
