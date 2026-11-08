import type { PairWeights } from "@fit-check/engine";
import type { Item } from "@fit-check/schema";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { TextLink } from "../../components/TextLink";
import { ActionSheet } from "./ActionSheet";
import type { DayContext } from "../../data/dayContext";
import { explainOutfit } from "./explain";
import { getOutfit } from "./outfit";
import { OutfitComposition, outfitIndex, SLOT_ORDER } from "./OutfitComposition";
import { DataStrip } from "../../components/editorial/DataStrip";
import { Reveal } from "../../components/editorial/Reveal";
import { layout } from "../../theme/tokens";

/** Wraps digits and the degree/percent signs so they stay LTR inside Hebrew text (DESIGN.md: numbers always LTR). */
const ltr = (s: string) => `⁦${s}⁩`;

/**
 * "Today" view (DESIGN.md section 3). Pure presentation: everything it shows comes in as props, so it can be
 * rendered with any wardrobe and any day (the container in app/index.tsx loads the real ones).
 *
 * Editorial structure: masthead and dateline, the composition with numbered captions, the reason as a pull quote,
 * then the facts as a data strip. Blocks enter in reading order (Reveal, 40ms apart).
 */
export function TodayView({ items, pairWeights, day }: { items: Item[]; pairWeights: PairWeights; day: DayContext }) {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const outfit = useMemo(() => getOutfit(items, pairWeights, day), [items, pairWeights, day]);
  const tagsById = useMemo(() => new Map(items.map((i) => [i.id, i.tags])), [items]);

  const locale = i18n.language === "en" ? "en" : "he";
  const gregorian = new Intl.DateTimeFormat(locale, { weekday: "long", day: "numeric", month: "long" }).format(
    new Date(`${day.date}T12:00:00`)
  );
  const hebrew = day.hebrewDate?.[locale];
  const dayLabel = day.holiday && day.dayType === "holiday" ? day.holiday[locale] : t(`today.dayType.${day.dayType}`);
  const w = day.weather;
  const explanation = outfit ? explainOutfit(t, day, outfit, dayLabel) : null;
  const pieces = outfit ? SLOT_ORDER.flatMap((slot) => outfit.items.filter((i) => i.slot === slot)) : [];
  const place = day.place ?? (day.usesCurrentLocation ? t("location.currentShort") : t("location.default"));

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
          <Reveal index={0}>
            <View className="flex-row items-baseline justify-between">
              <Text className="font-display text-display-xl text-ink">{t("today.title")}</Text>
              <TextLink href="/wardrobe" label={t("nav.wardrobe")} />
            </View>
            <Text className="mt-2 font-body text-body text-ink-soft">{hebrew ? `${hebrew} · ${gregorian}` : gregorian}</Text>
            {day.candleLighting ? (
              <Text className="mt-1 font-body text-body-sm text-ink-soft">{t("today.candles", { time: ltr(day.candleLighting) })}</Text>
            ) : null}
          </Reveal>

          {outfit && explanation ? (
            <>
              <Reveal index={1}>
                <View className="mt-12">
                  <OutfitComposition items={outfit.items} tagsById={tagsById} />
                </View>
                {/* Numbered captions: the names leave the frames and become a legend, like a magazine spread. */}
                <View className="mt-6 border-t border-hairline">
                  {pieces.map((piece) => (
                    <View key={piece.id} className="flex-row items-baseline border-b border-hairline py-2" style={{ gap: 12 }}>
                      <Text className="font-mono text-meta text-ink-faint">{outfitIndex(outfit.items, piece.id)}</Text>
                      <Text className="font-body text-body-sm text-ink">{t(`item.subcategory.${piece.subcategory}`)}</Text>
                      <Text className="font-body text-meta text-ink-faint" numberOfLines={1} style={{ flexShrink: 1 }}>
                        {piece.name}
                      </Text>
                    </View>
                  ))}
                </View>
              </Reveal>

              <Reveal index={2}>
                {/* Pull quote: the one sentence that says why, set in the display face under a rule. */}
                <View className="mt-12 border-t border-ink pt-4">
                  <Text className="font-display text-display text-ink">{explanation.lead}</Text>
                  {explanation.notes.map((n) => (
                    <Text key={n} className="mt-2 font-body text-body-sm text-ink-soft">
                      {n}
                    </Text>
                  ))}
                </View>
              </Reveal>

              <Reveal index={3}>
                <View className="mt-12">
                  {w ? (
                    <DataStrip
                      cells={[
                        { label: t("today.data.feels"), value: ltr(`${w.temp_min_c}–${w.temp_max_c}°`), mono: true },
                        { label: t("today.data.rain"), value: ltr(`${Math.round(w.rain_probability * 100)}%`), mono: true },
                        { label: t("today.data.sky"), value: t(`today.sky.${w.sky}`) },
                      ]}
                    />
                  ) : (
                    <Text className="font-body text-body-sm text-ink-soft">{t("today.noWeather")}</Text>
                  )}
                  <Pressable onPress={() => router.push("/location")} accessibilityRole="button" className="mt-4 self-start" hitSlop={8}>
                    <View className="border-b border-hairline pb-1">
                      <Text className="font-body text-body-sm text-ink">{t("location.label", { place })}</Text>
                    </View>
                  </Pressable>
                  {/* CC BY 4.0 attribution is a condition of both free APIs. */}
                  <Text className="mt-3 font-body text-meta text-ink-faint">{t("today.credits")}</Text>
                </View>
              </Reveal>
            </>
          ) : (
            <Text className="mt-12 font-body text-body text-ink-soft">{t("today.empty")}</Text>
          )}
        </ScrollView>
        <ActionSheet />
      </View>
    </View>
  );
}
