import { Pressable, Text, View } from "react-native";
import Animated from "react-native-reanimated";
import { layout, type ColorToken } from "../../theme/tokens";
import { Icon, type IconName } from "./Icon";
import { focusRingProps, usePressFeedback } from "./interaction";

type Common = {
  onPress: () => void;
  disabled?: boolean;
  /** Stretch to the parent's width (the Today action bar). */
  fullWidth?: boolean;
};

/** A labelled button. `icon` is a leading glyph; the label stays, since an icon alone is not self-explanatory. */
type Labelled = Common & {
  variant?: "primary" | "ink" | "outline" | "text";
  label: string;
  icon?: IconName;
  accessibilityLabel?: string;
};

/** An icon-only button. There is no visible text, so the screen-reader label is required. */
type IconOnly = Common & {
  variant: "icon";
  icon: IconName;
  accessibilityLabel: string;
  /** Selected state for toggles (e.g. `tune` with an active filter). */
  selected?: boolean;
  /**
   * Hairline frame at button height (48), for an icon that sits beside a labelled button in one row (the Today
   * action bar): a bare 44 glyph next to a 48 block reads as misaligned.
   */
  outlined?: boolean;
  /**
   * An ivory square under the glyph, for an icon that sits over a picture (the item hero's back and more buttons,
   * DESIGN.md section 3 "פריט"): the glyph stays readable on any tile tone without a shadow or a scrim.
   */
  surface?: boolean;
};

export type ButtonProps = Labelled | IconOnly;

const SURFACE = {
  primary: { box: "bg-accent", text: "text-accent-ink", icon: "accent-ink" },
  ink: { box: "bg-ink", text: "text-ivory", icon: "ivory" },
  outline: { box: "border border-hairline", text: "text-ink", icon: "ink" },
} as const satisfies Record<string, { box: string; text: string; icon: ColorToken }>;

// Disabled reads as inert, not as a lighter colour that could pass for another variant.
const DISABLED_OPACITY = 0.4;

/**
 * The app's one button (DESIGN.md section 4): 48 high, radius 6, body-sm semibold.
 * - `primary`: accent; at most one per screen (section 1).
 * - `ink`: the strong neutral (Add, confirmations that are not the screen's main action).
 * - `outline`: hairline frame, secondary.
 * - `text`: ink text over a hairline underline, 44 hit area.
 * - `icon`: 44×44, glyph only, label required; `outlined` makes it a 48 hairline square to sit beside a button.
 * Press = scale 0.97 in 120ms; disabled = 0.4 and inert. Web shows the keyboard focus ring.
 */
export function Button(props: ButtonProps) {
  const { onPressIn, onPressOut, pressStyle } = usePressFeedback();
  const disabled = props.disabled ?? false;
  const common = {
    ...focusRingProps,
    onPress: props.onPress,
    onPressIn,
    onPressOut,
    disabled,
    accessibilityRole: "button" as const,
  };

  if (props.variant === "icon") {
    const selected = props.selected ?? false;
    const side = props.outlined ? layout.control : layout.hit;
    return (
      <Pressable
        {...common}
        accessibilityLabel={props.accessibilityLabel}
        accessibilityState={{ disabled, selected }}
        className={`items-center justify-center rounded ${props.outlined ? `border ${selected ? "border-ink" : "border-hairline"}` : ""} ${props.surface ? "bg-ivory" : ""}`}
        style={{ width: side, height: side, opacity: disabled ? DISABLED_OPACITY : 1 }}
      >
        <Animated.View style={pressStyle}>
          {/* mirrorInRtl is safe for every icon: Icon only flips the directional ones. */}
          <Icon name={props.icon} size={24} color={selected ? "ink" : "ink-soft"} mirrorInRtl />
        </Animated.View>
      </Pressable>
    );
  }

  const variant = props.variant ?? "primary";
  const width = props.fullWidth ? "self-stretch" : "self-start";

  if (variant === "text") {
    return (
      <Pressable
        {...common}
        accessibilityLabel={props.accessibilityLabel ?? props.label}
        accessibilityState={{ disabled }}
        className={`justify-center ${width}`}
        style={{ minHeight: layout.hit, opacity: disabled ? DISABLED_OPACITY : 1 }}
      >
        {/* Underline is a bordered wrapper: RN cannot offset or colour text-decoration. */}
        <Animated.View style={[pressStyle, { alignSelf: "flex-start" }]}>
          <View className="flex-row items-center border-b border-hairline pb-1">
            {props.icon ? (
              <View className="me-1">
                <Icon name={props.icon} color="ink" mirrorInRtl />
              </View>
            ) : null}
            <Text className="font-body-semibold text-body-sm text-ink">{props.label}</Text>
          </View>
        </Animated.View>
      </Pressable>
    );
  }

  const s = SURFACE[variant];
  return (
    <Pressable
      {...common}
      accessibilityLabel={props.accessibilityLabel ?? props.label}
      accessibilityState={{ disabled }}
      className={width}
      style={{ opacity: disabled ? DISABLED_OPACITY : 1 }}
    >
      {/* The animated layer carries only the transform; colours sit on a plain View because NativeWind ignores
          className on Reanimated views. */}
      <Animated.View style={pressStyle}>
        <View className={`flex-row items-center justify-center rounded px-6 ${s.box}`} style={{ height: layout.control }}>
          {props.icon ? (
            <View className="me-2">
              <Icon name={props.icon} color={s.icon} mirrorInRtl />
            </View>
          ) : null}
          <Text className={`font-body-semibold text-body-sm ${s.text}`} numberOfLines={1}>
            {props.label}
          </Text>
        </View>
      </Animated.View>
    </Pressable>
  );
}
