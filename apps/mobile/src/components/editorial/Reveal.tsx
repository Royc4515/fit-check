import { useEffect, type ReactNode } from "react";
import Animated, { Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withDelay, withTiming } from "react-native-reanimated";
import { motion } from "../../theme/tokens";

/** Gap between consecutive blocks; 4 blocks finish within ~300ms, well under DESIGN.md's 500ms ceiling. */
const STAGGER_MS = 40;
/** Past this index everything enters together: a long cascade reads as slow, not premium. */
const MAX_STAGGERED = 4;

/**
 * Entrance for one block of a screen: opacity 0->1 and 8px rise over 180ms ease-out (DESIGN.md section 4, the
 * generic motion), delayed by its index so blocks arrive in reading order. Reduced motion: opacity only.
 * Runs once on mount, on the UI thread; nothing re-renders during it.
 */
export function Reveal({ index = 0, children }: { index?: number; children: ReactNode }) {
  const reduce = useReducedMotion();
  const p = useSharedValue(0);
  useEffect(() => {
    p.set(withDelay(Math.min(index, MAX_STAGGERED) * STAGGER_MS, withTiming(1, { duration: motion.stateMs, easing: Easing.bezier(...motion.easeOut) })));
  }, [p, index]);
  const style = useAnimatedStyle(() => ({
    opacity: p.get(),
    transform: [{ translateY: reduce ? 0 : (1 - p.get()) * 8 }],
  }));
  return <Animated.View style={style}>{children}</Animated.View>;
}
