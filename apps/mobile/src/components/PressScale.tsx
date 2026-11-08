import { type ReactNode } from "react";
import { Pressable, type PressableProps } from "react-native";
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";

const ease = Easing.bezier(0.2, 0, 0, 1);

/**
 * Press feedback: scale to 0.97 on press-in, back on release, 120ms ease-out (animate-expo: feedback on press-in,
 * never wait for the tap to complete). Shared value, so a fast tap never re-renders the cell.
 */
export function PressScale({ children, ...props }: PressableProps & { children: ReactNode }) {
  const scale = useSharedValue(1);
  const style = useAnimatedStyle(() => ({ transform: [{ scale: scale.get() }] }));
  return (
    <Pressable
      {...props}
      onPressIn={(e) => {
        scale.set(withTiming(0.97, { duration: 120, easing: ease }));
        props.onPressIn?.(e);
      }}
      onPressOut={(e) => {
        scale.set(withTiming(1, { duration: 120, easing: ease }));
        props.onPressOut?.(e);
      }}
    >
      <Animated.View style={style}>{children}</Animated.View>
    </Pressable>
  );
}
