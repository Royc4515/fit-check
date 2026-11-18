import * as Haptics from "expo-haptics";
import { Platform } from "react-native";
import { Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from "react-native-reanimated";
import { isRtl } from "../../i18n";
import { motion } from "../../theme/tokens";

/** The one easing DESIGN.md allows, built once. */
export const easeOut = Easing.bezier(...motion.easeOut);

/** Timing config for a duration from `motion`. */
export const timing = (duration: number) => ({ duration, easing: easeOut });

/**
 * Spread onto a Pressable: on web it adds `data-focusring`, which global.css turns into the keyboard focus ring
 * (ink 2px, offset 2). A typed object spread, because RN's types have no `dataSet` but react-native-web reads it;
 * the excess-property check does not apply to JSX spreads. Nothing on native, where focus is the OS's.
 */
export const focusRingProps: object = Platform.OS === "web" ? { dataSet: { focusring: "" } } : {};

/** The state of a pressable that screen readers must hear: one of the pairs the helper below knows how to say. */
export type A11yState = {
  /** Tabs, list choices. Role tab / option. */
  selected?: boolean;
  /** Checkboxes and radios. Role checkbox / radio. */
  checked?: boolean;
  /** Toggle buttons (a chip that is on or off). Role button. */
  pressed?: boolean;
  /** Buttons that open or close something (a sheet, a list). Role button. */
  expanded?: boolean;
  disabled?: boolean;
};

/** The DOM attributes {@link webStateProps} can return. Typed here because RN's own types do not list them all. */
export type WebStateProps = {
  "aria-selected"?: boolean;
  "aria-checked"?: boolean;
  "aria-pressed"?: boolean;
  "aria-expanded"?: boolean;
  "aria-disabled"?: boolean;
};

const NO_WEB_STATE: WebStateProps = {};

/**
 * Spread onto a Pressable next to `accessibilityState`. react-native-web does not turn `accessibilityState` into
 * `aria-*` attributes, so on the web a chosen tab, a checked tile or an open menu button was invisible to screen
 * readers and to tests. This is the one place that maps the state to the right attribute (`selected` →
 * `aria-selected`, `checked` → `aria-checked`, `pressed` → `aria-pressed`, `expanded` → `aria-expanded`,
 * `disabled` → `aria-disabled`). Only the keys the caller passes are emitted, so a role never gets an attribute it
 * does not allow. Returns an empty object on native, where `accessibilityState` already does the job.
 */
export function webStateProps(state: A11yState): WebStateProps {
  if (Platform.OS !== "web") return NO_WEB_STATE;
  const out: WebStateProps = {};
  if (state.selected !== undefined) out["aria-selected"] = state.selected;
  if (state.checked !== undefined) out["aria-checked"] = state.checked;
  if (state.pressed !== undefined) out["aria-pressed"] = state.pressed;
  if (state.expanded !== undefined) out["aria-expanded"] = state.expanded;
  if (state.disabled) out["aria-disabled"] = true;
  return out;
}

/** Native selection tick (chip, tab, tile). Web has no haptics; expo-haptics would only warn there. */
export function selectionHaptic(): void {
  if (Platform.OS !== "web") void Haptics.selectionAsync();
}

/** Layout direction of the active locale. Read at render; changing language reloads the app on native anyway. */
export function useRtl(): boolean {
  return isRtl();
}

// Reduced motion has no scale, so the press still needs a visible answer. Opacity is the only motion allowed then.
const REDUCED_PRESS_OPACITY = 0.8;
const PRESSED_SCALE = 0.97;

/**
 * Press feedback shared by every pressable in ui/: scale 1 → 0.97 over 120ms on press-in (feedback starts on
 * touch, not on release), and a 0..1 `lift` progress for components that fade in `shadow.lift` beneath themselves.
 * Shared values only: a fast tap never re-renders. Reduced motion: no scale, a short opacity dip instead.
 * @returns handlers for Pressable and two animated styles (`pressStyle` for the moving element, `liftStyle` for the
 * shadow layer).
 */
export function usePressFeedback() {
  const reduce = useReducedMotion();
  const p = useSharedValue(0);
  const onPressIn = () => p.set(withTiming(1, timing(motion.pressMs)));
  const onPressOut = () => p.set(withTiming(0, timing(motion.pressMs)));
  const pressStyle = useAnimatedStyle(() =>
    reduce ? { opacity: 1 - (1 - REDUCED_PRESS_OPACITY) * p.get() } : { transform: [{ scale: 1 - (1 - PRESSED_SCALE) * p.get() }] }
  );
  const liftStyle = useAnimatedStyle(() => ({ opacity: p.get() }));
  return { onPressIn, onPressOut, pressStyle, liftStyle };
}
