import { useCallback, useRef } from "react";
import type { LayoutChangeEvent } from "react-native";
import { usePanGesture, type PanGestureConfig } from "react-native-gesture-handler";
import { useAnimatedStyle, useReducedMotion, useSharedValue, withSpring, withTiming } from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import { selectionHaptic, timing, useRtl } from "../../components/ui/interaction";
import { motion } from "../../theme/tokens";

/** The clothes follow the finger at this share of its travel: weight, not a free slide. */
const FOLLOW = 0.6;
/** Dragging the wrong way only gives a little: there is no "previous outfit". */
const BACKWARD = 0.15;
/** Release past this share of the surface's width skips (DESIGN.md section 5: 30%). */
const THRESHOLD = 0.3;
/** Or a fling faster than this, px/s, in the skip direction, however short. */
const FLING = 800;
/** Horizontal travel before the pan claims the touch; vertical travel past FAIL hands it to the scroll view. */
const ACTIVATE = 12;
const FAIL = 12;
const RISE = 8;
/** A tap that ends within this long after a drag is the drag's release, not a press on a garment. */
const PRESS_GUARD_MS = 250;

/**
 * Swipe on the flat-lay = skip to the next candidate (DESIGN.md section 3 "היום" item 7, section 5 item 6).
 *
 * Direction: toward the START edge means "next" (left in LTR, right in RTL), the page-turn of each script: the
 * outgoing outfit leaves the way the reader's eye has already passed, the next one comes from where reading goes.
 *
 * Pan + shared values only, all on the UI thread. Past 30% of the width or a fast fling the clothes leave, then
 * `onSkip` runs (the write); when it settles, whichever outfit is current (the next, or the same one if the write
 * failed) enters with fade + 8px rise. Short of that, a critically damped spring back with the finger's velocity.
 * Reduced motion: nothing follows the finger and the skip is an instant change.
 *
 * @returns the gesture for a GestureDetector, the animated style for the garments layer, an onLayout for the
 * surface (the width the threshold is measured against), and `pressAllowed()`: false right after a drag, so the
 * release of a swipe that started on a garment does not also open that garment's sheet.
 */
export function useSwipeToSkip({ enabled, onSkip }: { enabled: boolean; onSkip: () => Promise<void> }) {
  const rtl = useRtl();
  const reduce = useReducedMotion();
  // Sign of translationX that means "next": RTL start is the right edge.
  const forward = rtl ? 1 : -1;
  const x = useSharedValue(0);
  const opacity = useSharedValue(1);
  const rise = useSharedValue(0);
  const width = useSharedValue(0);
  const lastDrag = useRef(0);

  const markDrag = useCallback(() => {
    lastDrag.current = Date.now();
  }, []);
  const pressAllowed = useCallback(() => Date.now() - lastDrag.current > PRESS_GUARD_MS, []);

  const enter = useCallback(() => {
    x.set(0);
    if (reduce) {
      opacity.set(1);
      return;
    }
    opacity.set(0);
    rise.set(RISE);
    opacity.set(withTiming(1, timing(motion.stateMs)));
    rise.set(withTiming(0, timing(motion.stateMs)));
  }, [x, opacity, rise, reduce]);

  const commit = useCallback(() => {
    selectionHaptic();
    void onSkip().then(enter);
  }, [onSkip, enter]);

  // don't touch / web touch scrolling. RNGH 3.3 applies GestureDetector's `touchAction` once at attach, then every
  // config change runs setGestureConfig(), whose resetConfig() clears it back to touch-action: none, and the
  // detector only re-applies when its own prop value changes. So the page could not be scrolled by a finger that
  // landed on the flat-lay. The gesture config's own `touchAction` survives every reset (it is in RNGH's
  // allowedNativeProps whitelist) but is missing from PanGestureConfig's type; a variable typed with it (not a
  // literal argument, which would fail the excess-property check, and not a cast) passes it through.
  const config: PanGestureConfig & { touchAction: "pan-y" } = {
    touchAction: "pan-y",
    enabled,
    activeOffsetX: [-ACTIVATE, ACTIVATE],
    failOffsetY: [-FAIL, FAIL],
    onActivate: () => {
      "worklet";
      scheduleOnRN(markDrag);
    },
    onUpdate: (e) => {
      "worklet";
      if (reduce) return;
      const t = e.translationX;
      x.set(t * forward > 0 ? t * FOLLOW : t * BACKWARD);
    },
    onDeactivate: (e) => {
      "worklet";
      scheduleOnRN(markDrag);
      const travelled = e.translationX * forward;
      const speed = e.velocityX * forward;
      if (travelled > width.get() * THRESHOLD || (speed > FLING && travelled > 0)) {
        if (reduce) {
          scheduleOnRN(commit);
          return;
        }
        x.set(withTiming(forward * width.get(), timing(motion.stateMs)));
        opacity.set(
          withTiming(0, timing(motion.stateMs), (finished) => {
            "worklet";
            if (finished) scheduleOnRN(commit);
          })
        );
      } else {
        x.set(withSpring(0, { ...motion.spring, velocity: e.velocityX * FOLLOW }));
      }
    },
  };
  const gesture = usePanGesture(config);

  const style = useAnimatedStyle(() => ({
    opacity: opacity.get(),
    transform: [{ translateX: x.get() }, { translateY: rise.get() }],
  }));

  const onLayout = useCallback((e: LayoutChangeEvent) => width.set(e.nativeEvent.layout.width), [width]);

  return { gesture, style, onLayout, pressAllowed };
}
