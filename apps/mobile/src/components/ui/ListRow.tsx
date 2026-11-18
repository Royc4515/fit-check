import { Pressable, Text, View } from "react-native";
import { colors, layout } from "../../theme/tokens";
import { Icon } from "./Icon";
import { focusRingProps } from "./interaction";

type Props = {
  label: string;
  /** Current value, at the end of the row in ink-soft. */
  value?: string;
  /** Present = the row is a button with a trailing chevron that points forward in either direction. */
  onPress?: () => void;
  disabled?: boolean;
};

/**
 * Settings-style row on a hairline: label at the start, value and chevron at the end. Min 44 high (body line +
 * 12 above and below = 51). Without `onPress` it is a plain label/value line, no chevron.
 */
export function ListRow({ label, value, onPress, disabled = false }: Props) {
  const content = (
    <View className="flex-row items-center border-b border-hairline py-3" style={{ minHeight: layout.hit, gap: 12 }}>
      <Text className="flex-1 font-body text-body text-ink" numberOfLines={1}>
        {label}
      </Text>
      {value ? (
        <Text className="font-body text-body-sm text-ink-soft" numberOfLines={1}>
          {value}
        </Text>
      ) : null}
      {onPress ? <Icon name="chevron" mirrorInRtl /> : null}
    </View>
  );
  if (!onPress) return content;
  return (
    <Pressable
      {...focusRingProps}
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={value ? `${label}, ${value}` : label}
      accessibilityState={{ disabled }}
      // Pressed = an ivory-deep wash, not a scale: a full-width row shrinking reads as the page jumping.
      style={({ pressed }) => ({ opacity: disabled ? 0.4 : 1, backgroundColor: pressed ? colors["ivory-deep"] : undefined })}
    >
      {content}
    </Pressable>
  );
}
