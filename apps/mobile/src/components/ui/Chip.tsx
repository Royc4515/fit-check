import { useTranslation } from "react-i18next";
import { Pressable, Text, View } from "react-native";
import Animated from "react-native-reanimated";
import { layout } from "../../theme/tokens";
import { Icon } from "./Icon";
import { focusRingProps, selectionHaptic, usePressFeedback } from "./interaction";
import { Swatch } from "./Swatch";

type Props = {
  label: string;
  onPress: () => void;
  selected?: boolean;
  disabled?: boolean;
  /** Garment colour shown as a 12px swatch before the label (colour tags). */
  swatch?: string;
  /**
   * The chip removes something (an active filter): a trailing `close` glyph, and the whole chip is the remove
   * target, labelled "remove <label>" for screen readers.
   */
  removable?: boolean;
  /** A suggestion, not a value yet: dashed hairline (DESIGN.md section 4). */
  dashed?: boolean;
  /** Overrides the spoken name, e.g. "Colour: navy, edit" for a chip that opens an editor rather than toggling. */
  accessibilityLabel?: string;
  accessibilityHint?: string;
  /**
   * A second action on long press. It is also exposed as a screen-reader action; the screen must offer it as a
   * plain button somewhere too (DESIGN.md section 6: a gesture is never the only way).
   */
  onLongPress?: () => void;
  /** Fill the parent's width with the label centred (a grid of equal chips, e.g. formality 1-10). */
  stretch?: boolean;
};

// Visible 36, hit 44 (DESIGN.md section 2): split the difference above and below.
const SLOP = (layout.hit - layout.chip) / 2;
/** Shorter than RN's 500 default: a held chip should answer before the finger starts to wonder. */
const LONG_PRESS_MS = 350;

/**
 * Chip: 36 high, radius 6, hairline. Selected = ink fill with ivory text, a change of shape (outline → solid), so
 * the state never rests on colour alone. Never accent (accent is one action per screen).
 */
export function Chip({
  label,
  onPress,
  selected = false,
  disabled = false,
  swatch,
  removable = false,
  dashed = false,
  accessibilityLabel,
  accessibilityHint,
  onLongPress,
  stretch = false,
}: Props) {
  const { t } = useTranslation();
  const { onPressIn, onPressOut, pressStyle } = usePressFeedback();
  const frame = selected ? "border-ink bg-ink" : `border-hairline ${dashed ? "border-dashed" : ""}`;
  const text = selected ? "text-ivory" : dashed ? "text-ink-soft" : "text-ink";
  return (
    <Pressable
      {...focusRingProps}
      onPress={() => {
        selectionHaptic();
        onPress();
      }}
      onLongPress={
        onLongPress
          ? () => {
              selectionHaptic();
              onLongPress();
            }
          : undefined
      }
      delayLongPress={onLongPress ? LONG_PRESS_MS : undefined}
      onPressIn={onPressIn}
      onPressOut={onPressOut}
      disabled={disabled}
      hitSlop={{ top: SLOP, bottom: SLOP }}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? (removable ? t("ui.remove", { label }) : label)}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ selected, disabled }}
      accessibilityActions={onLongPress ? [{ name: "longpress" }] : undefined}
      onAccessibilityAction={(e) => {
        if (e.nativeEvent.actionName === "longpress") onLongPress?.();
      }}
      style={{ opacity: disabled ? 0.4 : 1, ...(stretch ? { flex: 1 } : null) }}
    >
      <Animated.View style={pressStyle}>
        <View className={`flex-row items-center rounded border px-3 ${frame} ${stretch ? "justify-center" : ""}`} style={{ height: layout.chip }}>
          {swatch ? (
            <View className="me-2">
              <Swatch color={swatch} size={12} accessibilityLabel={label} />
            </View>
          ) : null}
          <Text className={`font-body text-body-sm ${text}`} numberOfLines={1}>
            {label}
          </Text>
          {removable ? (
            <View className="ms-1">
              <Icon name="close" color={selected ? "ivory" : "ink-soft"} />
            </View>
          ) : null}
        </View>
      </Animated.View>
    </Pressable>
  );
}
