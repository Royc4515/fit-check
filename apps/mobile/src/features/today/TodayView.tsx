import { combineAdjustments, learnedAdjustment, NO_ADJUSTMENT, swapOptions, type DayAdjustment, type PairWeights } from "@fit-check/engine";
import type { Item, Slot, StylistInput, StylistOutput } from "@fit-check/schema";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { TextLink } from "../../components/TextLink";
import { TextAction } from "../../components/TextAction";
import { ItemArt } from "../../components/item-art/ItemArt";
import { ActionSheet, type Adjust } from "./ActionSheet";
import type { DayContext } from "../../data/dayContext";
import type { FeedbackHistory } from "../../data/feedback";
import type { FeedbackActions, Laundered } from "../../data/useFeedback";
import { explainOutfit } from "./explain";
import { planToday, type Swaps } from "./outfit";
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
type Props = {
  items: Item[];
  pairWeights: PairWeights;
  day: DayContext;
  history: FeedbackHistory;
  actions: FeedbackActions;
  busy: boolean;
  failed: boolean;
  laundered?: Laundered | null;
  /** The AI stylist (stage B). Absent or returning null means the engine's order and template text are used. */
  stylist?: (input: StylistInput) => Promise<StylistOutput | null>;
};

/** Waits for taps (nudges, swaps) to settle before asking the stylist, so a burst of taps costs one call. */
const STYLIST_DEBOUNCE_MS = 600;

/** "Warmer", or "Warmer ×2" after two taps; null when that direction was not tapped. */
const adjustPart = (label: string, n: number) => (n <= 0 ? null : n === 1 ? label : `${label} ${ltr(`×${n}`)}`);

const ADJUST: Record<Adjust, DayAdjustment> = {
  warmer: { temp_steps: 1, formality_steps: 0 },
  cooler: { temp_steps: -1, formality_steps: 0 },
  dressier: { temp_steps: 0, formality_steps: 1 },
  casual: { temp_steps: 0, formality_steps: -1 },
};

export function TodayView({ items, pairWeights, day, history, actions, busy, failed, laundered, stylist }: Props) {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  // Session-only nudges and swaps (see engine/adjust.ts). Swaps belong to one suggestion: anything that changes
  // the suggestion (a nudge, a skip) clears them, or a swapped shirt would be pasted onto a different outfit.
  const [adjustment, setAdjustment] = useState<DayAdjustment>(NO_ADJUSTMENT);
  const [swaps, setSwaps] = useState<Swaps>({});
  const [swapping, setSwapping] = useState(false);
  const [swapSlot, setSwapSlot] = useState<Slot | null>(null);

  // The standing lean learned from recent wears, then today's taps on top. The total is what gets stored with a
  // worn outfit (see engine learnedAdjustment for why the total and not the taps).
  const learned = useMemo(() => learnedAdjustment(history.samples.map((s) => s.adjustment)), [history.samples]);
  const effective = useMemo(() => combineAdjustments(learned, adjustment), [learned, adjustment]);
  const locale = i18n.language === "en" ? "en" : "he";
  const gregorian = new Intl.DateTimeFormat(locale, { weekday: "long", day: "numeric", month: "long" }).format(
    new Date(`${day.date}T12:00:00`)
  );
  const dayLabel = day.holiday && day.dayType === "holiday" ? day.holiday[locale] : t(`today.dayType.${day.dayType}`);

  // The engine's own order first; the stylist then picks among its open candidates (never outside them).
  const base = useMemo(
    () => planToday({ items, pairWeights, day, history, adjustment: effective }),
    [items, pairWeights, day, history, effective]
  );
  const stylistInput = useMemo<StylistInput | null>(() => {
    if (base.kind !== "suggestion") return null;
    const byId = new Map(items.map((i) => [i.id, i.name]));
    const w = day.weather;
    return {
      context_type: day.dayType,
      date_label_he: `${day.date} ${day.holiday?.he ?? t(`today.dayType.${day.dayType}`, { lng: "he" })}`,
      weather_summary: w
        ? `${w.temp_min_c}-${w.temp_max_c}C, ${Math.round(w.rain_probability * 100)}% chance of rain, ${w.sky}`
        : "no forecast available",
      candidates: base.candidates.slice(0, 8),
      recent_outfits_summary: history.recent.slice(0, 7).map((r) => `${r.date}: ${r.item_ids.map((id) => byId.get(id) ?? "?").join(", ")}`),
    };
  }, [base, items, day, history.recent, t]);
  const stylistKey = stylistInput ? `${stylistInput.date_label_he}|${stylistInput.candidates.map((c) => c.outfit_id).join(",")}` : null;
  const [styledAnswer, setStyledAnswer] = useState<{ key: string; output: StylistOutput } | null>(null);
  useEffect(() => {
    if (!stylist || !stylistInput || !stylistKey) return;
    let active = true;
    const timer = setTimeout(() => {
      void stylist(stylistInput).then((output) => {
        if (active && output) setStyledAnswer({ key: stylistKey, output });
      });
    }, STYLIST_DEBOUNCE_MS);
    return () => {
      active = false;
      clearTimeout(timer);
    };
    // stylistKey captures everything about the input that should trigger a new call.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stylist, stylistKey]);
  const styled = styledAnswer && styledAnswer.key === stylistKey ? styledAnswer.output : null;

  const plan = useMemo(
    () => planToday({ items, pairWeights, day, history, adjustment: effective, swaps, preferredId: styled?.chosen_outfit_id ?? null }),
    [items, pairWeights, day, history, effective, swaps, styled]
  );
  const outfit = plan.kind === "empty" ? null : plan.outfit;
  const itemById = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  const options = useMemo(
    () => (plan.kind === "suggestion" && swapSlot ? swapOptions(items, plan.req, pairWeights, plan.items, swapSlot) : []),
    [plan, swapSlot, items, pairWeights]
  );

  const resetSwaps = () => {
    setSwaps({});
    setSwapping(false);
    setSwapSlot(null);
  };
  const adjust = (a: Adjust) => {
    resetSwaps();
    setAdjustment((cur) => ({
      temp_steps: cur.temp_steps + ADJUST[a].temp_steps,
      formality_steps: cur.formality_steps + ADJUST[a].formality_steps,
    }));
  };
  const adjustParts = [
    adjustPart(t("today.warmer"), adjustment.temp_steps),
    adjustPart(t("today.cooler"), -adjustment.temp_steps),
    adjustPart(t("today.dressier"), adjustment.formality_steps),
    adjustPart(t("today.casual"), -adjustment.formality_steps),
  ].filter((p): p is string => p !== null);
  const lastSkip = plan.kind === "worn" ? null : plan.lastSkip;

  const hebrew = day.hebrewDate?.[locale];
  const w = day.weather;
  const template = outfit ? explainOutfit(t, day, outfit, dayLabel) : null;
  // The stylist's sentence replaces the template lead only for the outfit it actually chose (not after a swap).
  const explanation =
    template && plan.kind === "suggestion" && plan.styled && styled
      ? { ...template, lead: locale === "en" ? styled.explanation_en : styled.explanation_he }
      : template;
  const pieces = outfit ? SLOT_ORDER.flatMap((slot) => outfit.items.filter((i) => i.slot === slot)) : [];
  const place = day.place ?? (day.usesCurrentLocation ? t("location.currentShort") : t("location.default"));

  /** What the user already told us today, each with its undo. Quiet lines, never a toast (DESIGN.md: no overlays). */
  function statusLines() {
    const lines: Array<{ key: string; text: string; links: Array<{ label: string; onPress: () => void }> }> = [];
    if (plan.kind === "worn") {
      const record = plan.record;
      lines.push({ key: "worn", text: t("today.status.worn"), links: [{ label: t("today.undo"), onPress: () => void actions.undo(record) }] });
      if (laundered && laundered.wearId === record.wearId) {
        const ids = laundered.itemIds;
        const names = ids.map((id) => {
          const sub = items.find((i) => i.id === id)?.tags.subcategory;
          return sub ? t(`item.subcategory.${sub}`) : "";
        });
        lines.push({
          key: "laundry",
          text: t("today.status.laundry", { items: names.filter(Boolean).join(", ") }),
          links: [{ label: t("today.keepHome"), onPress: () => void actions.keepHome(ids) }],
        });
      }
    }
    if (lastSkip) {
      const record = lastSkip;
      lines.push({
        key: "skip",
        text: record.feedback === "disliked" ? t("today.status.disliked") : t("today.status.skipped"),
        links: [
          ...(record.feedback === "skipped" ? [{ label: t("today.dislike"), onPress: () => void actions.dislike(record) }] : []),
          { label: t("today.undo"), onPress: () => void actions.undo(record).then(resetSwaps) },
        ],
      });
    }
    const learnedParts = [
      adjustPart(t("today.warmer"), learned.temp_steps),
      adjustPart(t("today.cooler"), -learned.temp_steps),
      adjustPart(t("today.dressier"), learned.formality_steps),
      adjustPart(t("today.casual"), -learned.formality_steps),
    ].filter((p): p is string => p !== null);
    if (learnedParts.length > 0 && plan.kind !== "worn") {
      lines.push({ key: "learned", text: t("today.adjust.learned", { parts: learnedParts.join(" · ") }), links: [] });
    }
    if (adjustParts.length > 0) {
      lines.push({
        key: "adjust",
        text: t("today.adjust.label", { parts: adjustParts.join(" · ") }),
        links: [{ label: t("today.adjust.reset"), onPress: () => (resetSwaps(), setAdjustment(NO_ADJUSTMENT)) }],
      });
    }
    if (failed) lines.push({ key: "failed", text: t("today.status.failed"), links: [] });
    if (lines.length === 0) return null;
    return (
      <View className="mt-6" style={{ gap: 12 }}>
        {lines.map((l) => (
          <View key={l.key} className="flex-row flex-wrap items-baseline" style={{ columnGap: 16, rowGap: 8 }}>
            <Text className="font-body text-body-sm text-ink-soft">{l.text}</Text>
            {l.links.map((link) => (
              <TextAction key={link.label} label={link.label} onPress={link.onPress} disabled={busy} quiet />
            ))}
          </View>
        ))}
      </View>
    );
  }

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
                  <OutfitComposition items={outfit.items} itemById={itemById} />
                </View>
                {/* Numbered captions: the names leave the frames and become a legend, like a magazine spread. */}
                <View className="mt-6 border-t border-hairline">
                  {pieces.map((piece) => (
                    <View key={piece.id} className="border-b border-hairline">
                      <Pressable
                        disabled={!swapping}
                        accessibilityRole={swapping ? "button" : undefined}
                        onPress={() => setSwapSlot((cur) => (cur === piece.slot ? null : piece.slot))}
                        className="flex-row items-baseline py-2"
                        style={{ gap: 12 }}
                      >
                        <Text className="font-mono text-meta text-ink-faint">{outfitIndex(outfit.items, piece.id)}</Text>
                        <Text className="font-body text-body-sm text-ink">{t(`item.subcategory.${piece.subcategory}`)}</Text>
                        <Text className="font-body text-meta text-ink-faint" numberOfLines={1} style={{ flexShrink: 1, flexGrow: 1 }}>
                          {piece.name}
                        </Text>
                        {swapping ? (
                          <Text className="font-body text-meta text-ink-soft">{swapSlot === piece.slot ? t("today.swapClose") : t("today.swapThis")}</Text>
                        ) : null}
                      </Pressable>
                      {swapSlot === piece.slot ? (
                        options.length > 0 ? (
                          <View className="flex-row pb-3" style={{ gap: 12 }}>
                            {options.map((o) => (
                              <Pressable
                                key={o.id}
                                accessibilityRole="button"
                                accessibilityLabel={o.name}
                                onPress={() => {
                                  setSwaps((cur) => ({ ...cur, [piece.slot]: o.id }));
                                  setSwapSlot(null);
                                }}
                                style={{ flex: 1 }}
                              >
                                <View className="rounded-sm bg-ivory-deep" style={{ width: "100%", aspectRatio: 4 / 5, padding: 8 }}>
                                  <ItemArt tags={o.tags} cutoutPath={o.cutout_path} />
                                </View>
                                <Text className="mt-1 font-body text-meta text-ink-soft" numberOfLines={2}>
                                  {o.name}
                                </Text>
                              </Pressable>
                            ))}
                          </View>
                        ) : (
                          <Text className="pb-3 font-body text-body-sm text-ink-soft">{t("today.noAlternatives")}</Text>
                        )
                      ) : null}
                    </View>
                  ))}
                </View>
                {swapping ? (
                  <View className="mt-3 flex-row items-baseline" style={{ gap: 16 }}>
                    <Text className="font-body text-body-sm text-ink-soft" style={{ flexShrink: 1 }}>
                      {t("today.swapHint")}
                    </Text>
                    <TextAction label={t("today.swapDone")} onPress={() => (setSwapping(false), setSwapSlot(null))} />
                  </View>
                ) : null}
                {statusLines()}
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
            <View className="mt-12">
              <Text className="font-body text-body text-ink-soft">{lastSkip ? t("today.allSkipped") : t("today.empty")}</Text>
              {statusLines()}
            </View>
          )}
        </ScrollView>
        {plan.kind === "suggestion" ? (
          <ActionSheet
            busy={busy}
            onWear={() => void actions.wear(plan.outfit, plan.source, effective).then(resetSwaps)}
            onSkip={() => void actions.skip(plan.outfit, plan.source, effective).then(resetSwaps)}
            onSwap={() => setSwapping(true)}
            onAdjust={adjust}
          />
        ) : null}
      </View>
    </View>
  );
}
