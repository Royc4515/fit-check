import type { PairWeights } from "@fit-check/engine";
import type { Item } from "@fit-check/schema";
import { useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useRouter } from "expo-router";
import Animated, { Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { TextLink } from "../components/TextLink";
import { ActionSheet } from "../features/today/ActionSheet";
import { WardrobeGate } from "../components/WardrobeGate";
import { useWardrobe } from "../data/WardrobeProvider";
import type { DayContext } from "../data/dayContext";
import { useDayContext } from "../data/useDayContext";
import { explainOutfit } from "../features/today/explain";
import { getOutfit } from "../features/today/outfit";
import { OutfitComposition } from "../features/today/OutfitComposition";
import { layout, motion } from "../theme/tokens";

/** Wraps digits and the degree/percent signs so they stay LTR inside Hebrew text (DESIGN.md: numbers always LTR). */
const ltr = (s: string) => `⁦${s}⁩`;

/**
 * "Today" (DESIGN.md section 3): the real wardrobe (Supabase), the real day (Hebcal) and the real forecast
 * (Open-Meteo). The explanation is built from the engine's facts until the AI stylist lands (PLAN.md phase B).
 * Entrance is the one allowed generic motion (opacity + translateY 8, 180ms ease-out), on the UI thread.
 */
export default function Index() {
  const wardrobe = useWardrobe();
  const day = useDayContext();
  if (wardrobe.status !== "ready") return <WardrobeGate state={wardrobe} />;
  // The day loads in parallel with the wardrobe and never fails; until it lands, the same quiet loading line.
  if (!day) return <WardrobeGate state={{ status: "loading" }} />;
  return <Today items={wardrobe.items} pairWeights={wardrobe.pairWeights} day={day} />;
}

function Today({ items, pairWeights, day }: { items: Item[]; pairWeights: PairWeights; day: DayContext }) {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const reduceMotion = useReducedMotion();

  const outfit = useMemo(() => getOutfit(items, pairWeights, day), [items, pairWeights, day]);
  const tagsById = useMemo(() => new Map(items.map((i) => [i.id, i.tags])), [items]);

  const locale = i18n.language === "en" ? "en" : "he";
  const gregorian = new Intl.DateTimeFormat(locale, { weekday: "long", day: "numeric", month: "long" }).format(
    new Date(`${day.date}T12:00:00`)
  );
  const hebrew = day.hebrewDate?.[locale];
  const dayLabel = day.holiday && day.dayType === "holiday" ? day.holiday[locale] : t(`today.dayType.${day.dayType}`);
  const w = day.weather;

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
            <Text className="mt-2 font-body text-body text-ink-soft">{hebrew ? `${hebrew} · ${gregorian}` : gregorian}</Text>
            {day.candleLighting ? (
              <Text className="mt-1 font-body text-body-sm text-ink-soft">{t("today.candles", { time: ltr(day.candleLighting) })}</Text>
            ) : null}

            {outfit ? (
              <>
                <View className="mt-12">
                  <OutfitComposition items={outfit.items} tagsById={tagsById} />
                </View>
                <Text className="mt-8 font-body text-body text-ink">{explainOutfit(t, day, outfit, dayLabel)}</Text>
                <Text className="mt-6 font-mono text-num text-ink-soft">
                  {w
                    ? t("today.weatherLine", {
                        sky: t(`today.sky.${w.sky}`),
                        range: ltr(`${w.temp_min_c}–${w.temp_max_c}°`),
                        rain: ltr(`${Math.round(w.rain_probability * 100)}%`),
                      })
                    : t("today.noWeather")}
                </Text>
                <Pressable onPress={() => router.push("/location")} accessibilityRole="button" className="mt-3 self-start" hitSlop={8}>
                  <View className="border-b border-hairline pb-1">
                    <Text className="font-body text-body-sm text-ink">
                      {t("location.label", {
                        place: day.place ?? (day.usesCurrentLocation ? t("location.currentShort") : t("location.default")),
                      })}
                    </Text>
                  </View>
                </Pressable>
                {/* CC BY 4.0 attribution is a condition of both free APIs. */}
                <Text className="mt-3 font-body text-meta text-ink-faint">{t("today.credits")}</Text>
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
