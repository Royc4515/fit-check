import { useEffect, useRef, type ReactNode } from "react";
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from "react-native-reanimated";
import { motion } from "../../theme/tokens";
import { timing } from "./interaction";

/**
 * Fades its content in, in place, whenever `swapKey` changes (motion.state, opacity only, no movement). For content
 * that is replaced wholesale, like Today's legend when another day's tab is chosen (DESIGN.md "שלב 4.1" item 3).
 * Reduced motion: the new content is there at once. The first render never animates.
 */
export function CrossFade({ swapKey, children }: { swapKey: string | number; children: ReactNode }) {
  const reduce = useReducedMotion();
  const opacity = useSharedValue(1);
  const last = useRef(swapKey);
  useEffect(() => {
    if (last.current === swapKey) return;
    last.current = swapKey;
    if (reduce) {
      opacity.set(1);
      return;
    }
    opacity.set(0);
    opacity.set(withTiming(1, timing(motion.stateMs)));
  }, [swapKey, reduce, opacity]);
  const style = useAnimatedStyle(() => ({ opacity: opacity.get() }));
  return <Animated.View style={style}>{children}</Animated.View>;
}
