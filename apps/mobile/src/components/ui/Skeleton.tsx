import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { View, type DimensionValue } from "react-native";
import Animated, { cancelAnimation, useAnimatedStyle, useReducedMotion, useSharedValue, withRepeat, withTiming } from "react-native-reanimated";
import type { TileTone } from "../../theme/tileTone";
import { colors, motion } from "../../theme/tokens";
import { easeOut } from "./interaction";

const LOW = 0.55;
const RADIUS = { none: 0, sm: 2, md: 6 } as const;

type Props = {
  width?: DimensionValue;
  height?: DimensionValue;
  /** Height / width; used when `height` is not given, so the box has its final size before content exists. */
  aspect?: number;
  tone?: TileTone;
  radius?: keyof typeof RADIUS;
};

/**
 * Loading placeholder (DESIGN.md sections 1 and 4): a rectangle in a tile tone at the final size, pulsing opacity
 * 1 ↔ 0.55 over 1200ms. No gradient, no shimmer, no spinner. Reduced motion: still, at full opacity.
 */
export function Skeleton({ width = "100%", height, aspect, tone = "tile", radius = "md" }: Props) {
  const { t } = useTranslation();
  const reduce = useReducedMotion();
  const o = useSharedValue(1);
  useEffect(() => {
    if (reduce) {
      o.set(1);
      return;
    }
    // Half a cycle each way, mirrored: one full pulse is motion.skeletonMs.
    o.set(withRepeat(withTiming(LOW, { duration: motion.skeletonMs / 2, easing: easeOut }), -1, true));
    return () => cancelAnimation(o);
  }, [o, reduce]);
  const style = useAnimatedStyle(() => ({ opacity: o.get() }));
  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={t("ui.loading")}
      accessibilityState={{ busy: true }}
      style={{ width, height, aspectRatio: height === undefined && aspect ? 1 / aspect : undefined }}
    >
      <Animated.View style={[{ flex: 1, backgroundColor: colors[tone], borderRadius: RADIUS[radius] }, style]} />
    </View>
  );
}
