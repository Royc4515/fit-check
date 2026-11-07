import type { PairWeights } from "@fit-check/engine";
import type { Item } from "@fit-check/schema";
import { useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { ScrollView, Text, View } from "react-native";
import Animated, { Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { TextLink } from "../components/TextLink";
import { ActionSheet } from "../features/today/ActionSheet";
import { WardrobeGate } from "../components/WardrobeGate";
import { useWardrobe } from "../data/WardrobeProvider";
import { MOCK_HEBREW_DATE, MOCK_TODAY, MOCK_WEATHER } from "../features/today/mock";
import { getOutfit } from "../features/today/outfit";
import { OutfitComposition } from "../features/today/OutfitComposition";
import { layout, motion } from "../theme/tokens";

/** Wraps digits and the degree/percent signs so they stay LTR inside Hebrew text (DESIGN.md: numbers always LTR). */
const ltr = (s: string) => `⁦${s}⁩`;

/**
 * "Today" (DESIGN.md section 3). The wardrobe is real (Supabase); date, weather and explanation are still mock (features/today/mock.ts).
 * Entrance is the one allowed generic motion (opacity + translateY 8, 180ms ease-out), on the UI thread.
 */
export default function Index() {
  const wardrobe = useWardrobe();
  if (wardrobe.status !== "ready") return <WardrobeGate state={wardrobe} />;
  return <Today items={wardrobe.items} pairWeights={wardrobe.pairWeights} />;
}

function Today({ items, pairWeights }: { items: Item[]; pairWeights: PairWeights }) {
  const { t, i18n } = useTranslation();
  const insets = useSafeAreaInsets();
  const reduceMotion = useReducedMotion();

  const outfit = useMemo(() => getOutfit(items, pairWeights), [items, pairWeights]);

  const locale = i18n.language === "en" ? "en" : "he";
  const gregorian = new Intl.DateTimeFormat(locale, { weekday: "long", day: "numeric", month: "long" }).format(
    new Date(`${MOCK_TODAY}T12:00:00`)
  );
  const hebrew = MOCK_HEBREW_DATE[locale];

  const enter = useSharedValue(0);
  useEffect(() => {
    enter.value = withTiming(1, { duration: motion.stateMs, easing: Easing.bezier(...motion.easeOut) });
  }, [enter]);
  const enterStyle = useAnimatedStyle(() => ({
    opacity: enter.value,
    // Reduced motion: opacity only (DESIGN.md section 4).
    transform: [{ translateY: reduceMotion ? 0 : (1 - enter.value) * 8 }],
  }));

  return (
    <View className="flex-1 bg-ivory">
      <View style={{ flex: 1, width: "100%", maxWidth: layout.maxContentWidth, alignSelf: "center" }}>
        <ScrollView
          contentContainerStyle={{
            paddingTop: insets.top + 32,
            paddingHorizontal: layout.gutter,
            paddingBottom: layout.sheetPeek + insets.bottom + 48,
          }}
        >
          <Animated.View style={enterStyle}>
            <View className="flex-row items-baseline justify-between">
              <Text className="font-display text-display-xl text-ink">{t("today.title")}</Text>
              <TextLink href="/wardrobe" label={t("nav.wardrobe")} />
            </View>
            <Text className="mt-2 font-body text-body text-ink-soft">{`${hebrew} · ${gregorian}`}</Text>

            {outfit ? (
              <>
                <View className="mt-12">
                  <OutfitComposition items={outfit.items} />
                </View>
                <Text className="mt-8 font-body text-body text-ink">{t("today.explanationMock")}</Text>
                <Text className="mt-6 font-mono text-num text-ink-soft">
                  {t("today.weather", {
                    day: t("today.context.weekday"),
                    range: ltr(`${MOCK_WEATHER.temp_min_c}–${MOCK_WEATHER.temp_max_c}°`),
                    rain: ltr(`${Math.round(MOCK_WEATHER.rain_probability * 100)}%`),
                  })}
                </Text>
              </>
            ) : (
              <Text className="mt-12 font-body text-body text-ink-soft">{t("today.empty")}</Text>
            )}
          </Animated.View>
        </ScrollView>
        <ActionSheet />
      </View>
    </View>
  );
}
