import { Pressable, Text, View } from "react-native";
import Animated from "react-native-reanimated";
import { layout } from "../../theme/tokens";
import { focusRingProps, selectionHaptic, usePressFeedback } from "./interaction";

type Side = { label: string; onPress: () => void };

type Props = {
  /** Toward the start: the "less" direction (cooler, more casual). */
  decrease: Side;
  /** Toward the end: the "more" direction (warmer, dressier). */
  increase: Side;
  /** Net taps so far; shown signed between the two buttons ("+2", "−1", "0"). */
  value: number;
  /** What the row adjusts, for screen readers ("temperature"). */
  accessibilityLabel: string;
  disabled?: boolean;
};

const VALUE_W = 48;
// A real minus sign, not a hyphen: in a mono face the hyphen sits low and short beside the plus.
const MINUS = "−";

function SideButton({ side, disabled, align }: { side: Side; disabled: boolean; align: "start" | "end" }) {
  const { onPressIn, onPressOut, pressStyle } = usePressFeedback();
  return (
    <Pressable
      {...focusRingProps}
      onPress={() => {
        selectionHaptic();
        side.onPress();
      }}
      onPressIn={onPressIn}
      onPressOut={onPressOut}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={side.label}
      accessibilityState={{ disabled }}
      className="flex-1 justify-center"
      style={{ minHeight: layout.hit, alignItems: align === "start" ? "flex-start" : "flex-end", opacity: disabled ? 0.4 : 1 }}
    >
      <Animated.View style={pressStyle}>
        <Text className="font-body text-body-sm text-ink" numberOfLines={1}>
          {side.label}
        </Text>
      </Animated.View>
    </Pressable>
  );
}

/**
 * Two opposite nudges on one hairline row with the running total between them (DESIGN.md section 3 "היום" item 6:
 * warmer / cooler, dressier / more casual). Unlike `Segmented` nothing is "selected": every tap stacks, so the
 * state is the number in the middle, in mono, ink once it is not zero. The number is announced with the label.
 */
export function Stepper({ decrease, increase, value, accessibilityLabel, disabled = false }: Props) {
  const shown = value > 0 ? `+${value}` : value < 0 ? `${MINUS}${-value}` : "0";
  return (
    // Not `adjustable`: on iOS that role swallows its children, and these are two real buttons.
    <View className="flex-row items-center border-b border-hairline">
      <SideButton side={decrease} disabled={disabled} align="start" />
      <View style={{ width: VALUE_W }} className="items-center">
        {/* Isolated LTR run: a signed number inside Hebrew must not have its sign moved by the bidi algorithm. */}
        <Text
          accessibilityLabel={`${accessibilityLabel}: ${shown}`}
          accessibilityLiveRegion="polite"
          // ink-soft at rest, not ink-faint: "0" is a value, and it must read at the same weight as the labels beside it.
          className={`font-mono text-num ${value === 0 ? "text-ink-soft" : "text-ink"}`}
        >{`⁦${shown}⁩`}</Text>
      </View>
      <SideButton side={increase} disabled={disabled} align="end" />
    </View>
  );
}
