import { Pressable, Text, View } from "react-native";
import { colors, layout } from "../../theme/tokens";
import { layoutRtl } from "../../i18n";
import { Icon } from "./Icon";
import { focusRingProps, webStateProps } from "./interaction";
import { textDirection } from "./textDirection";

type Props = {
  label: string;
  /** Current value, at the end of the row in ink-soft. */
  value?: string;
  /** Present = the row is a button with a trailing chevron that points forward in either direction. */
  onPress?: () => void;
  disabled?: boolean;
  /** Second line under the label in meta (a region, "default"). */
  meta?: string;
  /**
   * Makes this a choice row: a check at the end when true, no chevron either way, and the selected state announced.
   * Selection is a shape and a state, never only a colour (DESIGN.md section 1).
   */
  selected?: boolean;
};

/**
 * Settings-style row on a hairline: label at the start, value and chevron at the end. Min 44 high (body line +
 * 12 above and below = 51). Without `onPress` it is a plain label/value line, no chevron.
 */
export function ListRow({ label, value, onPress, disabled = false, meta, selected }: Props) {
  const choice = selected !== undefined;
  // don't touch / explicit direction per string: react-native-web leaves it to the first strong character of the
  // whole text, and in an RTL row a Latin run was truncated from its start ("…roit Jacket"). Dominant script, not first
  // strong: "חולצה · Carhartt WIP…" opens with a short Hebrew word. Start-aligned box,
  // not textAlign, so a Latin name still hugs the row's start edge (same reason as Tile's caption).
  const fallback = layoutRtl() ? "rtl" : "ltr";
  const dirOf = (text: string) => ({ writingDirection: textDirection(text, fallback), maxWidth: "100%" }) as const;
  const content = (
    <View className="flex-row items-center border-b border-hairline py-3" style={{ minHeight: layout.hit, gap: 12 }}>
      <View className="flex-1" style={{ alignItems: "flex-start" }}>
        <Text className="font-body text-body text-ink" numberOfLines={1} style={dirOf(label)}>
          {label}
        </Text>
        {meta ? (
          <Text className="font-body text-meta text-ink-soft" numberOfLines={2} style={dirOf(meta)}>
            {meta}
          </Text>
        ) : null}
      </View>
      {value ? (
        <Text className="font-body text-body-sm text-ink-soft" numberOfLines={1} style={dirOf(value)}>
          {value}
        </Text>
      ) : null}
      {choice ? selected ? <Icon name="check" color="ink" /> : null : onPress ? <Icon name="chevron" mirrorInRtl /> : null}
    </View>
  );
  if (!onPress) return content;
  return (
    <Pressable
      {...focusRingProps}
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={[label, value ?? meta].filter(Boolean).join(", ")}
      accessibilityState={{ disabled, selected: choice ? selected : undefined }}
      // pressed, not selected: aria-selected is not allowed on role=button (it belongs to option, tab, row).
      {...webStateProps({ pressed: choice ? selected : undefined, disabled })}
      // Pressed = an ivory-deep wash, not a scale: a full-width row shrinking reads as the page jumping.
      style={({ pressed }) => ({ opacity: disabled ? 0.4 : 1, backgroundColor: pressed ? colors["ivory-deep"] : undefined })}
    >
      {content}
    </Pressable>
  );
}
