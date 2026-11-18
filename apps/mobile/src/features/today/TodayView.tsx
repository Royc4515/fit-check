import { combineAdjustments, learnedAdjustment, NO_ADJUSTMENT, swapOptions, type DayAdjustment, type PairWeights } from "@fit-check/engine";
import type { Item, Slot, StylistInput, StylistOutput } from "@fit-check/schema";
import * as Haptics from "expo-haptics";
import { useRouter } from "expo-router";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Platform, Pressable, ScrollView, Text, View, useWindowDimensions } from "react-native";
import { GestureDetector } from "react-native-gesture-handler";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Reveal } from "../../components/editorial/Reveal";
import {
  ActionBar,
  Button,
  Display,
  EmptyState,
  FlatLay,
  LegendRow,
  Meta,
  StatusLine,
  type FlatLayPiece,
  type StatusVariant,
} from "../../components/ui";
import { focusRingProps } from "../../components/ui/interaction";
import type { DayContext } from "../../data/dayContext";
import type { FeedbackHistory } from "../../data/feedback";
import type { FeedbackActions, Laundered } from "../../data/useFeedback";
import { layout } from "../../theme/tokens";
import { AdjustSheet, type Adjust } from "./AdjustSheet";
import { explainOutfit } from "./explain";
import { planToday, type Swaps } from "./outfit";
import { PieceSheet } from "./PieceSheet";
import { outfitIndex, SLOT_ORDER } from "./pieces";
import { useSwipeToSkip } from "./useSwipeToSkip";

/** Wraps digits and the degree/percent signs so they stay LTR inside Hebrew text (DESIGN.md: numbers always LTR). */
const ltr = (s: string) => `⁦${s}⁩`;

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

/** An outfit needs one of each; layers and outerwear are optional. */
const REQUIRED_SLOTS = ["top", "bottom", "shoes"] as const;

/** Space kept between the last line of content and the floating bar's top edge. */
const UNDER_BAR = 32;
/** Desktop: the flat-lay column is at most this wide (DESIGN.md section 3 "היום" item 9). */
const DESKTOP_HERO_MAX = 560;
const DESKTOP_GAP = 64;
const DESKTOP_GUTTER = 32;

type StatusItem = {
  key: string;
  variant: StatusVariant;
  message: string;
  action?: { label: string; onPress: () => void };
  secondaryAction?: { label: string; onPress: () => void };
};

/**
 * "Today" (DESIGN.md section 3 "היום"). Pure presentation: everything it shows comes in as props, so it can be
 * rendered with any wardrobe and any day (the container in app/index.tsx loads the real ones).
 *
 * Masthead (title, dateline, weather that opens the location), the flat-lay of the outfit (tap a garment to swap
 * it, swipe to skip), its numbered legend, the reason as a pull quote, and a floating bar in the thumb zone with
 * "wearing it" (the screen's one accent) and `tune` for the rest. Statuses (worn, skipped, failed, laundry) replace
 * or join the bar so they are seen where the hand already is. Desktop (>= 900): two columns, nothing floats.
 */
export function TodayView({ items, pairWeights, day, history, actions, busy, failed, laundered, stylist }: Props) {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const desktop = width >= layout.desktopMin;

  // Session-only nudges and swaps (see engine/adjust.ts). Swaps belong to one suggestion: anything that changes
  // the suggestion (a nudge, a skip) clears them, or a swapped shirt would be pasted onto a different outfit.
  const [adjustment, setAdjustment] = useState<DayAdjustment>(NO_ADJUSTMENT);
  const [swaps, setSwaps] = useState<Swaps>({});
  // The piece sheet keeps the garment it was opened for, so its title does not change under the closing animation
  // when that garment has just been swapped out.
  const [piece, setPiece] = useState<{ slot: Slot; item: Item } | null>(null);
  const [pieceOpen, setPieceOpen] = useState(false);
  const [adjustOpen, setAdjustOpen] = useState(false);
  const [barHeight, setBarHeight] = useState(0);

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
  /**
   * Slots the wardrobe has nothing in at all. Roy, 2026-11-10: after the spreadsheet items were deleted the
   * wardrobe held shirts and coats only, and "no suggestion today" did not say why or what to do.
   */
  const missing = useMemo(
    () => REQUIRED_SLOTS.filter((slot) => !items.some((i) => i.status === "active" && i.tags.category === slot)),
    [items]
  );
  const itemById = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  const options = useMemo(
    () => (plan.kind === "suggestion" && piece ? swapOptions(items, plan.req, pairWeights, plan.items, piece.slot) : []),
    [plan, piece, items, pairWeights]
  );

  // A failed write is also felt, not only read (DESIGN.md section 5: `warning` on failure). Native only.
  useEffect(() => {
    if (failed && Platform.OS !== "web") void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
  }, [failed]);

  const resetSwaps = () => setSwaps({});
  const adjust = (a: Adjust) => {
    resetSwaps();
    setAdjustment((cur) => ({
      temp_steps: cur.temp_steps + ADJUST[a].temp_steps,
      formality_steps: cur.formality_steps + ADJUST[a].formality_steps,
    }));
  };
  const resetAdjust = () => {
    resetSwaps();
    setAdjustment(NO_ADJUSTMENT);
  };
  const skip = () => (plan.kind === "suggestion" ? actions.skip(plan.outfit, plan.source, effective).then(resetSwaps) : Promise.resolve());
  const swipe = useSwipeToSkip({ enabled: plan.kind === "suggestion" && !busy, onSkip: skip });

  const adjustParts = [
    adjustPart(t("today.warmer"), adjustment.temp_steps),
    adjustPart(t("today.cooler"), -adjustment.temp_steps),
    adjustPart(t("today.dressier"), adjustment.formality_steps),
    adjustPart(t("today.casual"), -adjustment.formality_steps),
  ].filter((p): p is string => p !== null);
  const learnedParts = [
    adjustPart(t("today.warmer"), learned.temp_steps),
    adjustPart(t("today.cooler"), -learned.temp_steps),
    adjustPart(t("today.dressier"), learned.formality_steps),
    adjustPart(t("today.casual"), -learned.formality_steps),
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
  const place = day.place ?? (day.usesCurrentLocation ? t("location.currentShort") : t("location.default"));

  const ordered = outfit ? SLOT_ORDER.flatMap((slot) => outfit.items.filter((i) => i.slot === slot)) : [];
  const typeOf = (sub: string) => t(`item.subcategory.${sub}`);
  const pieces: FlatLayPiece[] = outfit
    ? ordered.flatMap((p) => {
        const item = itemById.get(p.id);
        if (!item) return [];
        return [{ slot: p.slot, item, index: outfitIndex(outfit.items, p.id), accessibilityLabel: t("today.pieceLabel", { type: typeOf(p.subcategory), name: p.name }) }];
      })
    : [];
  const heroLabel = t("today.heroLabel", { pieces: ordered.map((p) => `${typeOf(p.subcategory)} ${p.name}`).join(", ") });

  const openPiece = (slot: Slot) => {
    if (!swipe.pressAllowed()) return;
    const id = outfit?.items.find((i) => i.slot === slot)?.id;
    const item = id ? itemById.get(id) : undefined;
    if (!item) return;
    setPiece({ slot, item });
    setPieceOpen(true);
  };

  /** What the user already told us today, each with its undo. Quiet lines, never a toast (DESIGN.md: no overlays). */
  const statuses: StatusItem[] = [];
  if (plan.kind === "worn") {
    const record = plan.record;
    statuses.push({ key: "worn", variant: "ok", message: t("today.status.worn"), action: { label: t("today.undo"), onPress: () => void actions.undo(record) } });
    if (laundered && laundered.wearId === record.wearId) {
      const ids = laundered.itemIds;
      const names = ids.map((id) => {
        const sub = itemById.get(id)?.tags.subcategory;
        return sub ? typeOf(sub) : "";
      });
      statuses.push({
        key: "laundry",
        variant: "info",
        message: t("today.status.laundry", { items: names.filter(Boolean).join(", ") }),
        action: { label: t("today.keepHome"), onPress: () => void actions.keepHome(ids) },
      });
    }
  }
  if (lastSkip) {
    const record = lastSkip;
    const undo = { label: t("today.undo"), onPress: () => void actions.undo(record).then(resetSwaps) };
    statuses.push({
      key: "skip",
      variant: "info",
      message: record.feedback === "disliked" ? t("today.status.disliked") : t("today.status.skipped"),
      action: undo,
      secondaryAction: record.feedback === "skipped" ? { label: t("today.dislike"), onPress: () => void actions.dislike(record) } : undefined,
    });
  }
  if (failed) statuses.push({ key: "failed", variant: "error", message: t("today.status.failed") });

  const statusLines = statuses.map((s) => (
    <StatusLine key={s.key} variant={s.variant} message={s.message} action={s.action} secondaryAction={s.secondaryAction} disabled={busy} />
  ));

  /** The learned lean and today's nudges: small, under the quote, because they qualify the reason. */
  const adjustNotes =
    (learnedParts.length > 0 && plan.kind !== "worn") || adjustParts.length > 0 ? (
      <View className="mt-4">
        {learnedParts.length > 0 && plan.kind !== "worn" ? <Meta tone="text-ink-soft">{t("today.adjust.learned", { parts: learnedParts.join(" · ") })}</Meta> : null}
        {adjustParts.length > 0 ? (
          <View className="flex-row flex-wrap items-center" style={{ columnGap: 16 }}>
            <Meta tone="text-ink-soft">{t("today.adjust.label", { parts: adjustParts.join(" · ") })}</Meta>
            <Button variant="text" label={t("today.adjust.reset")} onPress={resetAdjust} disabled={busy} />
          </View>
        ) : null}
      </View>
    ) : null;

  const weatherLine = w ? (
    <Text className="font-mono text-num text-ink">
      {ltr(`${w.temp_min_c}–${w.temp_max_c}°`)}
      {/* Plex Mono has no Hebrew: words switch to the body face inside the same line. */}
      <Text className="font-body text-ink-soft">{"  ·  "}</Text>
      <Text className="font-body">{`${t("today.data.rain")} `}</Text>
      {ltr(`${Math.round(w.rain_probability * 100)}%`)}
      <Text className="font-body text-ink-soft">{"  ·  "}</Text>
      <Text className="font-body">{t(`today.sky.${w.sky}`)}</Text>
    </Text>
  ) : (
    <Text className="font-body text-body-sm text-ink-soft">{t("today.noWeather")}</Text>
  );
  const weatherWords = w
    ? `${w.temp_min_c}–${w.temp_max_c}°, ${t("today.data.rain")} ${Math.round(w.rain_probability * 100)}%, ${t(`today.sky.${w.sky}`)}`
    : t("today.noWeather");

  const masthead = (
    <View>
      <Display size="display-xl" accessibilityRole="header">
        {t("today.title")}
      </Display>
      <Text className="mt-2 font-body text-body-sm text-ink-soft">{hebrew ? `${hebrew} · ${gregorian}` : gregorian}</Text>
      {day.candleLighting ? (
        <Text className="mt-1 font-body text-body-sm text-ink-soft">{t("today.candles", { time: ltr(day.candleLighting) })}</Text>
      ) : null}
      <Pressable
        {...focusRingProps}
        onPress={() => router.push("/location")}
        accessibilityRole="button"
        accessibilityLabel={t("today.weatherLabel", { weather: weatherWords, place })}
        className="mt-4 self-start"
        style={{ minHeight: layout.hit }}
      >
        {weatherLine}
        {/* The place is the link's visible half: underlined like every text action, so the line reads as tappable. */}
        <View className="mt-1 self-start border-b border-hairline pb-1">
          <Meta tone="text-ink-soft">{place}</Meta>
        </View>
      </Pressable>
    </View>
  );

  const hero =
    pieces.length > 0 ? (
      // Known gap (RNGH 3.3 web): the handler resets its config after the detector applies this, so the surface
      // still gets touch-action none and touch browsers cannot scroll the page from the flat-lay. Native is fine.
      <GestureDetector gesture={swipe.gesture} touchAction="pan-y">
        <View onLayout={swipe.onLayout}>
          <FlatLay
            pieces={pieces}
            onPressPiece={openPiece}
            instantKey={history.today.length}
            radius={desktop ? "md" : "none"}
            accessibilityLabel={heroLabel}
            contentStyle={swipe.style}
          />
        </View>
      </GestureDetector>
    ) : null;

  const captions = outfit ? (
    <View className="border-t border-hairline">
      {ordered.map((p) => (
        <LegendRow
          key={p.id}
          index={outfitIndex(outfit.items, p.id)}
          title={typeOf(p.subcategory)}
          detail={p.name}
          onPress={() => openPiece(p.slot)}
          accessibilityLabel={t("today.pieceLabel", { type: typeOf(p.subcategory), name: p.name })}
        />
      ))}
    </View>
  ) : null;

  const quote = explanation ? (
    <View>
      {/* Pull quote: the one sentence that says why, set in the display face under a 1px ink rule. */}
      <View className="border-t border-ink pt-4">
        <Display>{explanation.lead}</Display>
        {explanation.notes.map((n) => (
          <Text key={n} className="mt-2 font-body text-body-sm text-ink-soft">
            {n}
          </Text>
        ))}
      </View>
      {adjustNotes}
    </View>
  ) : null;

  // CC BY 4.0 attribution is a condition of both free APIs.
  const credits = <Meta>{t("today.credits")}</Meta>;

  const wear = () => {
    if (plan.kind !== "suggestion") return;
    if (Platform.OS !== "web") void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    void actions.wear(plan.outfit, plan.source, effective).then(resetSwaps);
  };
  const adjustActive = adjustment.temp_steps !== 0 || adjustment.formality_steps !== 0;

  const barContent: ReactNode =
    plan.kind === "suggestion" ? (
      <>
        {statusLines}
        <View className="flex-row items-center" style={{ gap: 8 }}>
          <View style={{ flex: 1 }}>
            <Button variant="primary" label={t("today.wearing")} onPress={wear} disabled={busy} fullWidth />
          </View>
          <Button
            variant="icon"
            outlined
            icon="tune"
            selected={adjustActive}
            accessibilityLabel={t("today.tune")}
            onPress={() => setAdjustOpen(true)}
            disabled={busy}
          />
        </View>
      </>
    ) : plan.kind === "worn" ? (
      <>{statusLines}</>
    ) : null;

  const empty =
    plan.kind === "empty" ? (
      <View>
        {lastSkip ? (
          <EmptyState title={t("today.allSkipped")} body={t("today.allSkippedBody")} />
        ) : missing.length > 0 ? (
          <EmptyState
            title={t("today.missingTitle")}
            body={t("today.missing", { what: missing.map((m) => t(`today.missingSlot.${m}`)).join(t("today.and")) })}
            action={{ label: t("nav.addClothes"), onPress: () => router.push("/intake") }}
          />
        ) : (
          <EmptyState title={t("today.empty")} body={t("today.emptyBody")} />
        )}
        {statusLines}
        {adjustNotes}
      </View>
    ) : null;

  const sheets = (
    <>
      <PieceSheet
        piece={piece?.item ?? null}
        open={pieceOpen}
        alternatives={plan.kind === "suggestion" ? options : null}
        onSwap={(o) => {
          if (piece) setSwaps((cur) => ({ ...cur, [piece.slot]: o.id }));
          setPieceOpen(false);
        }}
        onOpenItem={(id) => {
          setPieceOpen(false);
          router.push(`/item/${id}`);
        }}
        onClose={() => setPieceOpen(false)}
      />
      <AdjustSheet
        open={adjustOpen}
        onClose={() => setAdjustOpen(false)}
        adjustment={adjustment}
        onAdjust={adjust}
        onReset={resetAdjust}
        onSkip={
          plan.kind === "suggestion"
            ? () => {
                setAdjustOpen(false);
                void skip();
              }
            : undefined
        }
        busy={busy}
      />
    </>
  );

  if (desktop) {
    return (
      <View className="flex-1 bg-ivory">
        <ScrollView contentContainerStyle={{ paddingTop: insets.top + 32, paddingBottom: 64 + insets.bottom }}>
          <View
            className="flex-row items-start"
            style={{ width: "100%", maxWidth: layout.maxContentWidthWide, alignSelf: "center", paddingHorizontal: DESKTOP_GUTTER, gap: DESKTOP_GAP }}
          >
            <View style={{ flex: 1, maxWidth: DESKTOP_HERO_MAX }}>
              <Reveal index={1}>{hero ?? empty}</Reveal>
            </View>
            <View style={{ flex: 1 }}>
              <Reveal index={0}>{masthead}</Reveal>
              {outfit ? (
                <>
                  <Reveal index={2}>
                    <View className="mt-12">{captions}</View>
                  </Reveal>
                  <Reveal index={3}>
                    <View className="mt-12">{quote}</View>
                    <View className="mt-8">
                      <ActionBar floating={false}>{barContent}</ActionBar>
                    </View>
                    <View className="mt-12">{credits}</View>
                  </Reveal>
                </>
              ) : (
                <View className="mt-12">{credits}</View>
              )}
            </View>
          </View>
        </ScrollView>
        {sheets}
      </View>
    );
  }

  const hasBar = barContent !== null;
  return (
    <View className="flex-1 bg-ivory">
      <View style={{ flex: 1, width: "100%", maxWidth: layout.maxContentWidth, alignSelf: "center" }}>
        <ScrollView
          contentContainerStyle={{
            paddingTop: insets.top + 32,
            // Nothing may end under the floating bar: its measured height (it grows with status lines) plus air.
            paddingBottom: (hasBar ? barHeight : insets.bottom) + UNDER_BAR,
          }}
        >
          <Reveal index={0}>
            <View className="px-5">{masthead}</View>
          </Reveal>
          {outfit ? (
            <>
              <Reveal index={1}>
                <View className="mt-8">{hero}</View>
              </Reveal>
              <Reveal index={2}>
                <View className="mt-6 px-5">{captions}</View>
              </Reveal>
              <Reveal index={3}>
                <View className="mt-12 px-5">{quote}</View>
                <View className="mt-12 px-5">{credits}</View>
              </Reveal>
            </>
          ) : (
            <View className="px-5">
              {empty}
              <View className="mt-12">{credits}</View>
            </View>
          )}
        </ScrollView>
        {hasBar ? (
          <ActionBar floating onLayout={(e) => setBarHeight(e.nativeEvent.layout.height)}>
            {barContent}
          </ActionBar>
        ) : null}
      </View>
      {sheets}
    </View>
  );
}
