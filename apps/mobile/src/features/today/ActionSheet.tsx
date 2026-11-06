import * as Haptics from "expo-haptics";
import { useTranslation } from "react-i18next";
import { Pressable, Text, View } from "react-native";
import { GestureDetector, useExclusiveGestures, usePanGesture, useTapGesture } from "react-native-gesture-handler";
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors, layout, motion } from "../../theme/tokens";

const PRIMARY_H = 48;
const ROW_H = 36;
const ROW_GAP = 12;
const PAD = 24;

/** Two secondary actions side by side. Underline is a bordered wrapper: RN cannot offset or color text-decoration. */
function SecondaryRow({ left, right }: { left: string; right: string }) {
  return (
    <View className="flex-row" style={{ height: ROW_H, gap: PAD }}>
      {[left, right].map((label) => (
        <Pressable key={label} className="flex-1 justify-center" accessibilityRole="button">
          <View className="self-start border-b border-hairline pb-1">
            <Text className="font-body text-body-sm text-ink">{label}</Text>
          </View>
        </Pressable>
      ))}
    </View>
  );
}

/**
 * Bottom sheet with the five Today actions (wear, swap, temperature, formality, skip).
 * One shared value drives it; pan and tap are worklets, so React never re-renders mid-gesture.
 */
export function ActionSheet() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();

  const peek = layout.sheetPeek + insets.bottom;
  const sheetH = layout.sheetPeek + PRIMARY_H + PAD + 3 * ROW_H + 2 * ROW_GAP + PAD + insets.bottom;
  const closedY = sheetH - peek;

  const translateY = useSharedValue(closedY);
  const startY = useSharedValue(closedY);

  const pan = usePanGesture({
    activeOffsetY: [-8, 8],
    onBegin: () => {
      "worklet";
      startY.value = translateY.value;
    },
    onUpdate: (e) => {
      "worklet";
      translateY.value = Math.min(Math.max(startY.value + e.translationY, 0), closedY);
    },
    onDeactivate: (e) => {
      "worklet";
      // Project where the finger was heading, so a flick snaps the way it was thrown (velocity handoff).
      const projected = translateY.value + e.velocityY * 0.15;
      const target = projected > closedY / 2 ? closedY : 0;
      translateY.value = withSpring(target, { ...motion.spring, velocity: e.velocityY });
    },
  });

  const tap = useTapGesture({
    onActivate: (e) => {
      "worklet";
      // Only the visible handle strip toggles; taps on the actions below belong to their buttons.
      if (e.y > layout.sheetPeek) return;
      translateY.value = withSpring(translateY.value > closedY / 2 ? 0 : closedY, motion.spring);
    },
  });

  const gesture = useExclusiveGestures(pan, tap);
  const style = useAnimatedStyle(() => ({ transform: [{ translateY: translateY.value }] }));

  return (
    <GestureDetector gesture={gesture}>
      <Animated.View
        // don't touch / visuals are inline, not className: NativeWind silently ignores className on
        // Reanimated's Animated.View, which dropped `absolute` and pushed the sheet into the layout flow.
        // DESIGN.md allows no shadows except an open sheet's 0 -1px 0 hairline; Android cannot draw that
        // as a shadow, so it is a 1px top border: identical on screen, same on both OSes.
        style={[
          {
            position: "absolute",
            start: 0,
            end: 0,
            bottom: 0,
            height: sheetH,
            backgroundColor: colors["ivory-deep"],
            borderTopWidth: 1,
            borderTopColor: colors["hairline"],
          },
          style,
        ]}
      >
        <View style={{ height: layout.sheetPeek }} className="items-center justify-center">
          <View accessibilityLabel={t("today.actions")} className="w-8 bg-ink-faint" style={{ height: 2 }} />
        </View>
        <View style={{ paddingHorizontal: layout.gutter }}>
          <Pressable
            accessibilityRole="button"
            className="items-center justify-center rounded bg-accent"
            style={{ height: PRIMARY_H }}
            onPress={() => void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)}
          >
            <Text className="font-body-semibold text-body text-accent-ink">{t("today.wearing")}</Text>
          </Pressable>
          <View style={{ marginTop: PAD, gap: ROW_GAP }}>
            <SecondaryRow left={t("today.warmer")} right={t("today.cooler")} />
            <SecondaryRow left={t("today.dressier")} right={t("today.casual")} />
            <SecondaryRow left={t("today.swap")} right={t("today.skip")} />
          </View>
        </View>
      </Animated.View>
    </GestureDetector>
  );
}
