import { useEffect } from "react";
import { Pressable, Text, View } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { colors, layout, motion } from "../../theme/tokens";
import { focusRingProps, selectionHaptic, timing } from "./interaction";

export type Segment<K extends string> = { key: K; label: string };

type Props<K extends string> = {
  /** 2-4 segments (DESIGN.md section 4). More than four is a list, not a segmented control. */
  segments: readonly Segment<K>[];
  value: K;
  onChange: (key: K) => void;
  /** What the control chooses, for screen readers ("availability"). */
  accessibilityLabel: string;
  disabled?: boolean;
};

const UNDERLINE = 2;

function SegmentButton<K extends string>({
  segment,
  selected,
  onPress,
  disabled,
}: {
  segment: Segment<K>;
  selected: boolean;
  onPress: () => void;
  disabled: boolean;
}) {
  const on = useSharedValue(selected ? 1 : 0);
  useEffect(() => {
    on.set(withTiming(selected ? 1 : 0, timing(motion.stateMs)));
  }, [on, selected]);
  // Opacity, not a sliding bar: a slide would be translateX, which is direction-dependent and adds nothing here.
  const underline = useAnimatedStyle(() => ({ opacity: on.get() }));
  return (
    <Pressable
      {...focusRingProps}
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="radio"
      accessibilityLabel={segment.label}
      accessibilityState={{ checked: selected, disabled }}
      className="flex-1 items-center justify-center"
      style={{ minHeight: layout.hit }}
    >
      <Text className={`font-body text-body-sm ${selected ? "text-ink" : "text-ink-soft"}`} numberOfLines={1}>
        {segment.label}
      </Text>
      <Animated.View
        style={[{ position: "absolute", start: 0, end: 0, bottom: -1, height: UNDERLINE, backgroundColor: colors.ink }, underline]}
      />
    </Pressable>
  );
}

/**
 * Segmented control: equal segments on one hairline; the chosen one is ink text over a 2px ink underline (a mark,
 * not only a colour). The underline fades in 180ms. Radio semantics: exactly one is always chosen.
 */
export function Segmented<K extends string>({ segments, value, onChange, accessibilityLabel, disabled = false }: Props<K>) {
  return (
    <View accessibilityRole="radiogroup" accessibilityLabel={accessibilityLabel} className="flex-row border-b border-hairline">
      {segments.map((s) => (
        <SegmentButton
          key={s.key}
          segment={s}
          selected={s.key === value}
          disabled={disabled}
          onPress={() => {
            if (s.key === value) return;
            selectionHaptic();
            onChange(s.key);
          }}
        />
      ))}
    </View>
  );
}
