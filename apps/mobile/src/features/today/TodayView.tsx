import { combineAdjustments, learnedAdjustment, NO_ADJUSTMENT, swapOptions, type DayAdjustment, type PairWeights } from "@fit-check/engine";
import type { Item, Slot, StylistInput, StylistOutput } from "@fit-check/schema";
import * as Haptics from "expo-haptics";
import { useRouter } from "expo-router";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Platform, Pressable, ScrollView, Text, View, useWindowDimensions } from "react-native";
import { GestureDetector } from "react-native-gesture-handler";
import { useReducedMotion } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Reveal } from "../../components/editorial/Reveal";
import {
  ActionBar,
  Button,
  CrossFade,
  Display,
  EmptyState,
  FLAT_LAY_ASPECT,
  FlatLay,
  flatLayTone,
  LegendRow,
  Meta,
  StatusLine,
  TabPanel,
  TextTabs,
  type FlatLayPiece,
  type StatusVariant,
} from "../../components/ui";
import { focusRingProps } from "../../components/ui/interaction";
import type { DayContext } from "../../data/dayContext";
import type { FeedbackHistory } from "../../data/feedback";
import { chainTabLabels, defaultTab, type ChainTabLabel } from "../../data/shabbatTimes";
import type { OccasionsState } from "../../data/occasions";
import type { FeedbackActions, FeedbackTarget, Laundered } from "../../data/useFeedback";
import { layout, motion } from "../../theme/tokens";
import { flyFrom, registerOrigin } from "../item/transition";
import { AdjustSheet, type Adjust } from "./AdjustSheet";
import { explainOutfit } from "./explain";
import { settingGetNow, settingGet, settingSet } from "../../data/kv";
import { asCandidate, contextTypeOf, type DayInput, type Swaps, type TodayPlan } from "./outfit";
import { PieceSheet } from "./PieceSheet";
import { defaultAdjustment, occasionInEffect, occasionMayApply, planDays } from "./plans";
import { correctedPieces, outfitIndex, SLOT_ORDER } from "./pieces";
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
  /** The date of the day whose last action failed (useFeedback), or null; shown on that day's tab only. */
  failedOn: string | null;
  laundered?: Laundered | null;
  /**
   * The local time `HH:MM` when the screen opened, for the opening tab on the eve of Shabbat or a holiday (three
   * hours before candle lighting). Data, not a clock read here, so the choice is testable.
   */
  clock: string;
  /** The AI stylist (stage B). Absent or returning null means the engine's order and template text are used. */
  stylist?: (input: StylistInput) => Promise<StylistOutput | null>;
  /** What is on each date on screen, and how to change it (DESIGN.md "שלב 4.5"). */
  occasions: OccasionsState;
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
/** Air above and below the desktop flat-lay, which must fit whole in the viewport under the top nav. */
const DESKTOP_HERO_PAD = 32;
const DESKTOP_GAP = 64;
const DESKTOP_GUTTER = 32;
/** Desktop: space between the day tabs and the flat-lay under them. */
const DESKTOP_TABS_GAP = 24;
/** Mobile layout, wide windows (>= this): the flat-lay is a centred card, not full-bleed, and capped to fit above the bar. */
const CARD_MIN_WIDTH = 600;
/**
 * Air kept between the flat-lay's bottom edge and whatever ends the free space at scroll top: the floating bar's top,
 * or the bottom of the scene (the tab bar's top) when there is no bar (DESIGN.md section 3 "היום" item 2).
 */
const HERO_CLEARANCE = 16;
/**
 * The 4:5 composition is never narrower than this when capping (a short window would otherwise shrink the hero to
 * a thumbnail); below it the hero keeps this size and the page scrolls.
 */
const HERO_MIN = 240;
/** Mobile layout's scroll padding above the masthead, and the space between masthead and flat-lay (see its comment). */
const MOBILE_TOP = 24;
const MOBILE_HERO_GAP = 16;

/** DOM ids of the places focus is sent to after an action (web only; see the focus effect in TodayView). */
const FOCUS_WORN_STATUS = "today-worn-status";
const FOCUS_SKIP_STATUS = "today-skip-status";
const FOCUS_WEAR = "today-wear";
/** The adjust button, where an occasion is chosen: focus goes there after the occasion line's "cancel". */
const FOCUS_TUNE = "today-tune";
/** The first thing in a container that a keyboard can reach: react-native-web gives every live pressable tabindex 0. */
/** A little longer than the sheet's critically damped close spring takes to settle (motion.spring). */
const SHEET_SETTLE_MS = 700;
const FIRST_TABBABLE = '[tabindex="0"]:not([aria-disabled="true"])';
/** Device flag: the one-time "tap any garment" line has been acted on (DESIGN.md "שלב 5.1" item 2). */
const TAP_HINT_KEY = "fitcheck:tap-hint-seen";
/** Ids of the day tabs and their panel (WAI-ARIA tabs pattern). */
const DAY_TABS = "today-day";

/** The i18n key of a planned day's tab ("for Shabbat", "for Yom Kippur", "for the holiday", "holiday, day 1"). */
const tabKey = (label: ChainTabLabel) =>
  label.kind === "shabbat"
    ? "today.tabs.shabbat"
    : label.kind === "yom_kippur"
      ? "today.tabs.yomKippur"
      : label.day === null
        ? "today.tabs.holiday"
        : `today.tabs.holidayDay${label.day}`;

/** A planned day's "I'll wear it on ..." and "Logged: ... for ..." keys, by what the day is. */
const plannedKeys = (kind: "shabbat" | "holiday" | "yom_kippur") =>
  kind === "shabbat"
    ? { wear: "today.wearOnShabbat", worn: "today.status.wornShabbat" }
    : kind === "yom_kippur"
      ? { wear: "today.wearOnYomKippur", worn: "today.status.wornYomKippur" }
      : { wear: "today.wearOnHoliday", worn: "today.status.wornHoliday" };

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
 * "wearing it" (the screen's one accent) and `tune` for the rest. Once the outfit is worn the bar is gone and the
 * worn and laundry lines take the skip line's place between masthead and flat-lay, so the whole flat-lay stays in
 * view (DESIGN.md section 3 "היום" item 8). A failed "wearing it" is the only status that stays in the bar, next to
 * the button it belongs to. Desktop (>= 900): two columns, nothing floats.
 */
export function TodayView({ items, pairWeights, day, history, actions, busy, failedOn, laundered, stylist, clock, occasions }: Props) {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const desktop = width >= layout.desktopMin;
  const reduceMotion = useReducedMotion();

  // Today first, then each phone-free day that today's candle lighting opens (DESIGN.md "שלב 4.1"). Without candles
  // the list is just today and the screen is exactly what it was before the tabs.
  // Whether today's occasion may decide its look now: a weekday, or Shabbat / a holiday after its havdalah (4.5 item 3).
  const todayOccasion = useMemo(
    () => ({ tab: "today" as const, dayType: day.dayType, havdalahToday: day.end?.day === "today" ? day.end.time : null, now: clock }),
    [day, clock]
  );
  const days = useMemo<DayInput[]>(
    () => [
      {
        date: day.date,
        weather: day.weather,
        dayType: day.dayType,
        festive: day.festive,
        yomKippur: day.yomKippur,
        occasion: occasionInEffect(occasions.byDate[day.date]?.type, todayOccasion),
      },
      // A planned day's tab is planned by Shabbat's or the holiday's rules, never by an occasion (4.5 item 3).
      ...day.chain.map((d) => ({ date: d.date, weather: d.weather, dayType: d.dayType, yomKippur: d.yomKippur })),
    ],
    [day, occasions.byDate, todayOccasion]
  );
  const tabLabels = useMemo(() => chainTabLabels(day.chain), [day.chain]);
  const hasTabs = day.chain.length > 0;
  // The opening tab, decided once from the clock and the answers at hand when the screen opened: wearing today's
  // outfit must not pull the screen to Shabbat under the user's thumb (item 3 is about where the screen opens).
  const [openingTab] = useState(() =>
    day.chain[
      defaultTab({
        now: clock,
        candles: day.candles?.time ?? null,
        todayRecorded: history.today.some((r) => r.feedback === "worn"),
        recorded: day.chain.map((d) => history.ahead.some((r) => r.date === d.date && r.feedback === "worn")),
      }) - 1
    ]?.date ?? day.date
  );
  // A tab chosen by hand lasts while the screen is mounted, no longer (item 3).
  const [chosenTab, setChosenTab] = useState<string | null>(null);
  const selectedDate = [chosenTab, openingTab].find((d) => d !== null && days.some((x) => x.date === d)) ?? day.date;
  const sel = Math.max(0, days.findIndex((d) => d.date === selectedDate));
  const planned = sel > 0 ? day.chain[sel - 1]! : null;
  // A planned day's answers go on its date; a day with an occasion records the occasion's context (4.5 item 6).
  const occasion = days[sel]!.occasion ?? null;
  const target: FeedbackTarget | undefined =
    planned || occasion ? { date: selectedDate, dayType: contextTypeOf(days[sel]!) } : undefined;
  const failed = failedOn !== null && failedOn === selectedDate;

  // Session-only nudges and swaps (see engine/adjust.ts), per day. Swaps belong to one suggestion: anything that
  // changes the suggestion (a nudge, a skip) clears them, or a swapped shirt would be pasted onto a different outfit.
  const [adjustments, setAdjustments] = useState<Readonly<Record<string, DayAdjustment>>>({});
  const [swapsByDay, setSwapsByDay] = useState<Readonly<Record<string, Swaps>>>({});
  // A day's taps start from its default (one "dressier" step on a holiday with the observance switch off), so the
  // sheet shows that step as taken and can take it back.
  const tapsOf = (d: DayInput) => adjustments[d.date] ?? defaultAdjustment(d);
  const adjustment = tapsOf(days[sel]!);
  // The piece sheet keeps the garment it was opened for, so its title does not change under the closing animation
  // when that garment has just been swapped out.
  const [piece, setPiece] = useState<{ slot: Slot; item: Item } | null>(null);
  const [pieceOpen, setPieceOpen] = useState(false);
  // "Tap any garment to swap it", shown until it has been acted on once on this device (DESIGN.md "שלב 5.1" item 2).
  // Web reads the flag before the first paint; native reads it a moment later and the line may show for that moment.
  const [showHint, setShowHint] = useState(() => settingGetNow(TAP_HINT_KEY) === null);
  useEffect(() => {
    let active = true;
    void settingGet(TAP_HINT_KEY).then((seen) => {
      if (active && seen !== null) setShowHint(false);
    });
    return () => {
      active = false;
    };
  }, []);
  const dismissHint = () => {
    if (!showHint) return;
    setShowHint(false);
    void settingSet(TAP_HINT_KEY, "seen");
  };
  const [adjustOpen, setAdjustOpen] = useState(false);
  // The floating bar's measured height; 0 = not rendered or not measured yet (reset when the bar leaves, so a bar that
  // comes back is never capped against its old height).
  const [barHeight, setBarHeight] = useState(0);
  // The scene's height (desktop: under the top nav; mobile: down to the tab bar's top), to cap the flat-lay.
  const [viewportHeight, setViewportHeight] = useState(0);
  // Mobile layout: what stands above the flat-lay, measured, so the cap follows every line that joins it. The
  // masthead (a Friday adds the times row) and the status stack (day tabs, forecast, skip, worn, laundry and failure
  // lines); null = not measured yet. Sizes, not positions: on web onLayout comes from a ResizeObserver, which a move
  // does not fire.
  const [mastheadHeight, setMastheadHeight] = useState(0);
  const [aboveHeroHeight, setAboveHeroHeight] = useState<number | null>(null);
  // Mobile: the day tabs' row (with the space above it), measured apart: it stands outside the day's panel.
  const [tabsHeight, setTabsHeight] = useState(0);
  // Desktop: the day tabs sit above the flat-lay column, so its cap subtracts them.
  const [desktopTabsHeight, setDesktopTabsHeight] = useState(0);
  // Where focus goes once the action that was just taken has settled (web). The button the hand was on is replaced by
  // a status line when it works, and a focused element that unmounts drops focus to <body>.
  const [focusRequest, setFocusRequest] = useState<{ after: "wear" | "skip" | "undo"; n: number } | null>(null);
  const focusHandled = useRef(0);
  const requestFocus = (after: "wear" | "skip" | "undo") => setFocusRequest((cur) => ({ after, n: (cur?.n ?? 0) + 1 }));
  // After "cancel" on the occasion line the line is gone and focus would drop to the page: send it to `tune`, where an
  // occasion is chosen again (web; on the next frame, once the line has left). Worn days have no bar: the status stack.
  const focusTune = () => {
    if (Platform.OS !== "web") return;
    requestAnimationFrame(() => {
      const box = document.getElementById(FOCUS_TUNE) ?? document.getElementById(FOCUS_WORN_STATUS);
      (box?.querySelector<HTMLElement>(FIRST_TABBABLE) ?? box)?.focus();
    });
  };

  // The standing lean learned from recent wears, then each day's taps on top. The total is what gets stored with a
  // worn outfit (see engine learnedAdjustment for why the total and not the taps).
  const learned = useMemo(() => learnedAdjustment(history.samples.map((s) => s.adjustment)), [history.samples]);
  const effectiveByDay = useMemo(
    () => days.map((d) => combineAdjustments(learned, tapsOf(d))),
    // tapsOf reads only `adjustments`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [days, learned, adjustments]
  );
  const effective = effectiveByDay[sel]!;
  const locale = i18n.language === "en" ? "en" : "he";
  const gregorian = new Intl.DateTimeFormat(locale, { weekday: "long", day: "numeric", month: "long" }).format(
    new Date(`${day.date}T12:00:00`)
  );
  /** A day's name in the explanation: the holiday's own name on a Yom Tov, else its day type. */
  const dayLabelOf = (k: number, lng: "he" | "en" = locale) => {
    const d = days[k]!;
    // The explanation names the occasion instead of the day type (DESIGN.md "שלב 4.5" item 2).
    if (d.occasion) return t(`today.occasion.type.${d.occasion}`, { lng });
    const holiday = k === 0 ? day.holiday : (day.chain[k - 1]?.holiday ?? null);
    // A festive weekday (the switch off) is still called by its holiday's name.
    return holiday && (d.dayType === "holiday" || d.festive) ? holiday[lng] : t(`today.dayType.${d.dayType}`, { lng });
  };
  const dayLabel = dayLabelOf(sel);

  // The stylist's answers, by request key, for every day asked so far this session. Each day is asked only when its
  // tab is open (item 4: the planned day's request goes out when its tab is first opened, not with the screen).
  const [answers, setAnswers] = useState<Readonly<Record<string, StylistOutput>>>({});
  const asked = useRef(new Set<string>());
  const labelHe = (k: number) => {
    const d = days[k]!;
    if (d.occasion) return `${d.date} ${t(`today.occasion.type.${d.occasion}`, { lng: "he" })}`;
    const holiday = k === 0 ? day.holiday : (day.chain[k - 1]?.holiday ?? null);
    return `${d.date} ${holiday?.he ?? t(`today.dayType.${d.dayType}`, { lng: "he" })}`;
  };
  const keyFor = (k: number, base: TodayPlan) =>
    base.kind === "suggestion" ? `${labelHe(k)}|${base.candidates.slice(0, 8).map((c) => c.outfit_id).join(",")}` : null;

  // The engine's own order first; the stylist then picks among each day's open candidates (never outside them).
  // Days are planned in order: a later day sees the looks chosen for the earlier ones (plans.ts).
  const plans = useMemo(
    () =>
      planDays({
        items,
        pairWeights,
        days,
        history,
        adjustments: effectiveByDay,
        swaps: days.map((d) => swapsByDay[d.date]),
        prefer: (k, base) => {
          const key = keyFor(k, base);
          return key ? (answers[key]?.chosen_outfit_id ?? null) : null;
        },
      }),
    // keyFor reads only `days`, `day` and `t`, all listed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [items, pairWeights, days, day, history, effectiveByDay, swapsByDay, answers, t]
  );
  const selected = plans[sel]!;
  const base = selected.base;
  const plan = selected.plan;
  const dayHistory = selected.history;
  const dayWeather = planned ? planned.weather : day.weather;
  const stylistKey = keyFor(sel, base);
  const stylistInput = useMemo<StylistInput | null>(() => {
    if (base.kind !== "suggestion") return null;
    const byId = new Map(items.map((i) => [i.id, i.name]));
    const w = dayWeather;
    return {
      context_type: contextTypeOf(days[sel]!),
      date_label_he: labelHe(sel),
      weather_summary: w
        ? `${w.temp_min_c}-${w.temp_max_c}C, ${Math.round(w.rain_probability * 100)}% chance of rain, ${w.sky}`
        : "no forecast available",
      candidates: base.candidates.slice(0, 8),
      recent_outfits_summary: dayHistory.recent.slice(0, 7).map((r) => `${r.date}: ${r.item_ids.map((id) => byId.get(id) ?? "?").join(", ")}`),
    };
    // stylistKey captures the candidates and the day; the rest follows from them.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stylistKey]);
  useEffect(() => {
    if (!stylist || !stylistInput || !stylistKey || asked.current.has(stylistKey)) return;
    let active = true;
    const timer = setTimeout(() => {
      // Marked when sent, not when scheduled: a tab left within the debounce has not been asked yet.
      asked.current.add(stylistKey);
      void stylist(stylistInput).then((output) => {
        if (active && output) setAnswers((cur) => ({ ...cur, [stylistKey]: output }));
      });
    }, STYLIST_DEBOUNCE_MS);
    return () => {
      active = false;
      clearTimeout(timer);
    };
    // stylistKey captures everything about the input that should trigger a new call.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stylist, stylistKey]);
  const styled = stylistKey ? (answers[stylistKey] ?? null) : null;

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
  // Swap options come from the day's own pool: a garment kept for Shabbat is not offered on Friday as a swap either.
  // The pieces on screen as items: the suggestion's, or the recorded outfit's once worn (DESIGN.md "שלב 5.1" item 1).
  const shownItems = useMemo(
    () => (plan.kind === "suggestion" ? plan.items : plan.kind === "worn" ? plan.record.itemIds.flatMap((id) => itemById.get(id) ?? []) : []),
    [plan, itemById]
  );
  const options = useMemo(
    () => (plan.kind !== "empty" && piece ? swapOptions(selected.pool, plan.req, pairWeights, shownItems, piece.slot) : []),
    [plan, piece, selected.pool, pairWeights, shownItems]
  );

  // A failed write is also felt, not only read (DESIGN.md section 5: `warning` on failure). Native only.
  useEffect(() => {
    if (failed && Platform.OS !== "web") void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
  }, [failed]);

  // Each acts on the selected day; the date is read when the action is taken, so a later tab change cannot redirect it.
  const resetSwaps = (date: string = selectedDate) => setSwapsByDay((cur) => (cur[date] ? { ...cur, [date]: {} } : cur));
  const adjust = (a: Adjust) => {
    resetSwaps();
    setAdjustments((cur) => {
      const now = cur[selectedDate] ?? defaultAdjustment(days[sel]!);
      return {
        ...cur,
        [selectedDate]: { temp_steps: now.temp_steps + ADJUST[a].temp_steps, formality_steps: now.formality_steps + ADJUST[a].formality_steps },
      };
    });
  };
  const resetAdjust = () => {
    resetSwaps();
    setAdjustments((cur) => ({ ...cur, [selectedDate]: NO_ADJUSTMENT }));
  };
  const skip = () =>
    plan.kind === "suggestion"
      ? actions.skip(plan.outfit, plan.source, effective, target).then(() => {
          resetSwaps();
          requestFocus("skip");
        })
      : Promise.resolve();
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
  const template = outfit ? explainOutfit(t, { weather: dayWeather, dayType: days[sel]!.dayType, occasion: occasion ?? undefined }, outfit, dayLabel) : null;
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
  const heroPieces = ordered.map((p) => `${typeOf(p.subcategory)} ${p.name}`).join(", ");
  // A planned day's flat-lay is named by its tab ("For Shabbat: ..."), not as today's outfit.
  const heroLabel = planned
    ? t("today.heroLabelPlanned", { tab: t(tabKey(tabLabels[sel - 1]!)), pieces: heroPieces })
    : t("today.heroLabel", { pieces: heroPieces });

  const openPiece = (slot: Slot) => {
    if (!swipe.pressAllowed()) return;
    dismissHint();
    const id = outfit?.items.find((i) => i.slot === slot)?.id;
    const item = id ? itemById.get(id) : undefined;
    if (!item) return;
    actions.dismissFailure();
    setPiece({ slot, item });
    setPieceOpen(true);
  };

  /** What the user already told us today, each with its undo. Quiet lines, never a toast (DESIGN.md: no overlays). */
  const statuses: StatusItem[] = [];
  if (plan.kind === "worn") {
    const record = plan.record;
    const wornMessage = planned ? t(plannedKeys(planned.kind).worn) : t("today.status.worn");
    statuses.push({ key: "worn", variant: "ok", message: wornMessage, action: { label: t("today.undo"), onPress: () => void actions.undo(record).then(() => requestFocus("undo")) } });
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
    const undo = {
      label: t("today.undo"),
      onPress: () =>
        void actions.undo(record).then(() => {
          resetSwaps();
          requestFocus("undo");
        }),
    };
    statuses.push({
      key: "skip",
      variant: "info",
      message: record.feedback === "disliked" ? t("today.status.disliked") : t("today.status.skipped"),
      action: undo,
      secondaryAction: record.feedback === "skipped" ? { label: t("today.dislike"), onPress: () => void actions.dislike(record) } : undefined,
    });
  }
  if (failed) statuses.push({ key: "failed", variant: "error", message: t("today.status.failed") });

  const lineOf = (s: StatusItem) => (
    <StatusLine key={s.key} variant={s.variant} message={s.message} action={s.action} secondaryAction={s.secondaryAction} disabled={busy} />
  );
  const statusLines = statuses.map(lineOf);
  // The skip line lives above the hero, not in the bar: it can stay all day, and a bar that grows with it would
  // cover a sixth of the phone.
  const skipStatus = statuses.find((s) => s.key === "skip");
  // Worn: the bar is gone (nothing left to press), so the worn line, the laundry line and any failure of undo or
  // keep-home take the skip line's slot above the hero. Pinned to the bottom they covered the shoes (Roy, 19.11).
  const wornLines = plan.kind === "worn" ? statuses.map(lineOf) : [];
  // What stays in the bar is a failed "wearing it", beside the button that failed.
  const barStatusLines = plan.kind === "suggestion" ? statuses.filter((s) => s.key === "failed").map(lineOf) : [];
  const barStatusLine =
    barStatusLines.length > 0 ? (
      <View tabIndex={-1} style={{ gap: 8 }}>
        {barStatusLines}
      </View>
    ) : null;
  // What is on the day (4.5 item 2): first among the status lines, with its label and, unless set by hand, where it
  // came from; "cancel" clears it. A failed write takes its place, with "try again" (item 4).
  // Only where an occasion can apply: today, on a weekday or after the day's havdalah (4.5 items 1 and 3).
  const occasionChoosable = !planned && occasionMayApply(todayOccasion);
  const occasionRow = occasionChoosable ? (occasions.byDate[selectedDate] ?? null) : null;
  const occasionFailed = occasionChoosable && occasions.failed?.date === selectedDate ? occasions.failed : null;
  const occasionText = occasionRow
    ? [t(`today.occasion.type.${occasionRow.type}`), occasionRow.label, occasionRow.source === "calendar" ? t("today.occasion.fromCalendar") : undefined]
        .filter((part): part is string => Boolean(part))
        .reduce((first, second) => t("today.timesJoin", { first, second }))
    : null;
  // The one-time cue that garments can be tapped (5.1 item 2), until the first tap on a garment or "got it".
  const hintLine =
    showHint && outfit ? <StatusLine variant="info" message={t("today.tapHint")} action={{ label: t("today.tapHintOk"), onPress: dismissHint }} /> : null;
  const occasionLine = occasionFailed ? (
    <StatusLine variant="error" message={t("today.occasion.failed")} action={{ label: t("common.retry"), onPress: occasionFailed.retry }} />
  ) : occasionText ? (
    <StatusLine
      variant="info"
      message={occasionText}
      action={{
        label: t("today.occasion.cancel"),
        // The visible word is the screen's usual "cancel"; the name says what it cancels.
        accessibilityLabel: occasionRow ? t("today.occasion.cancelLabel", { type: t(`today.occasion.type.${occasionRow.type}`) }) : undefined,
        onPress: () => {
          occasions.choose(selectedDate, null);
          focusTune();
        },
      }}
      disabled={busy}
    />
  ) : null;
  // Yom Kippur with no non-leather shoe at home: the look comes without shoes, and says so (PRD section 7).
  const noShoesLine =
    days[sel]!.yomKippur && outfit && !outfit.items.some((i) => i.slot === "shoes") ? (
      <StatusLine variant="info" message={t("today.status.noLeatherFreeShoes")} />
    ) : null;
  // One focusable wrapper (tabIndex -1: reachable by script, not by Tab) so focus has a place to land when a line
  // has no action of its own, and screen readers read the whole stack when it arrives.
  const wornStatus = (className: string) =>
    wornLines.length > 0 ? (
      <View className={className} nativeID={FOCUS_WORN_STATUS} tabIndex={-1} style={{ gap: 8 }}>
        {wornLines}
      </View>
    ) : null;

  // After wear / skip / undo the button (or the status line) the hand was on is gone: send focus to the new status
  // line's first action (undo), or the wrapper when it has none, and back to "wearing it" (in the bar again) after
  // an undo.
  // Waits for `busy` to end: a pressable that is still disabled is not a place to put focus.
  const planKind = plan.kind;
  const tuneLabel = t("today.tune");
  const hasSkipStatus = skipStatus !== undefined;
  useEffect(() => {
    // Each request is served once: `n` counts them, `focusHandled` (read only here) remembers the last one served.
    if (!focusRequest || busy || Platform.OS !== "web" || focusHandled.current === focusRequest.n) return;
    focusHandled.current = focusRequest.n;
    const { after } = focusRequest;
    const within = (id: string) => {
      const el = document.getElementById(id);
      return el ? (el.querySelector<HTMLElement>(FIRST_TABBABLE) ?? el) : null;
    };
    const targetId = planKind === "worn" ? FOCUS_WORN_STATUS : after === "skip" && hasSkipStatus ? FOCUS_SKIP_STATUS : FOCUS_WEAR;
    within(targetId)?.focus();
    // don't touch / a skip taken from the adjust sheet finishes while the sheet is still sliding away, and on unmount
    // the sheet's Modal hands focus back to its opener (the tune button), over what was just set. Look again after
    // it has settled and take focus back only if it was lost to the body or the opener, never from something the
    // user has moved to meanwhile. No cleanup on purpose: the lookup is by id and harmless if the screen is gone.
    window.setTimeout(() => {
      const at = document.activeElement;
      const lost = !at || at === document.body || at.getAttribute("aria-label") === tuneLabel;
      if (lost) within(targetId)?.focus();
    }, SHEET_SETTLE_MS);
  }, [focusRequest, busy, planKind, hasSkipStatus, tuneLabel]);

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

  // The day tabs (DESIGN.md "שלב 4.1" item 2): today, then each planned day. Moving between them with the keyboard
  // keeps focus on the tab (TextTabs stays mounted in one place in every state, see the layouts below).
  const dayTabs = hasTabs ? (
    <TextTabs
      tabs={[{ key: day.date, label: t("today.tabs.today") }, ...day.chain.map((d, i) => ({ key: d.date, label: t(tabKey(tabLabels[i]!)) }))]}
      value={selectedDate}
      onChange={setChosenTab}
      accessibilityLabel={t("today.tabs.label")}
      inset={desktop ? 0 : layout.gutter}
      idPrefix={DAY_TABS}
    />
  ) : null;
  // A planned day's own forecast, named by its day (item 8): "Shabbat · 14–22° · rain 0%", or "no forecast yet".
  const plannedName = planned
    ? planned.dayType === "shabbat"
      ? t("today.dayType.shabbat")
      : new Intl.DateTimeFormat(locale, { weekday: "long" }).format(new Date(`${planned.date}T12:00:00`))
    : null;
  const plannedForecast = planned ? (
    <Meta>
      {planned.weather
        ? t("today.plannedForecast", {
            day: plannedName,
            range: ltr(`${planned.weather.temp_min_c}–${planned.weather.temp_max_c}°`),
            rain: ltr(`${Math.round(planned.weather.rain_probability * 100)}%`),
          })
        : t("today.plannedNoForecast")}
    </Meta>
  ) : null;
  // Mobile: the planned day's forecast opens the measured block above the hero, inside the day's panel. Its line is
  // held on the today tab too (empty, hidden from readers), so a tab change does not move the hero by a line's height.
  const forecastSlot = hasTabs ? (
    <View className="mt-4 px-5">
      {plannedForecast ?? (
        <View aria-hidden importantForAccessibility="no-hide-descendants" style={{ opacity: 0 }}>
          <Meta>{"\u00a0"}</Meta>
        </View>
      )}
    </View>
  ) : null;

  // Spec DESIGN.md section 3 "היום" item 1: the entry line is named by the day, the end joins it only when it is
  // today or tomorrow (data/shabbatTimes.ts decides that).
  const entryLine = day.candles ? t(day.candles.kind === "shabbat" ? "today.candles" : "today.candlesOther", { time: ltr(day.candles.time) }) : null;
  // "tomorrow" only when the end is tomorrow's and today is not a Friday: on a Friday every calendar prints just
  // "Shabbat ends 17:17", on any other day a bare time would read as ending before the candles (DESIGN.md "היום").
  const endTomorrow = day.end?.day === "tomorrow" && day.candles?.kind !== "shabbat";
  const endKeys = {
    shabbat: ["today.shabbatEnd", "today.shabbatEndTomorrow"],
    holiday: ["today.holidayEnd", "today.holidayEndTomorrow"],
    fast: ["today.fastEnd", "today.fastEndTomorrow"],
  } as const;
  const endLine = day.end ? t(endKeys[day.end.kind][endTomorrow ? 1 : 0], { time: ltr(day.end.time) }) : null;
  const timesLine = entryLine && endLine ? t("today.timesJoin", { first: entryLine, second: endLine }) : (entryLine ?? endLine);

  const masthead = (
    <View>
      <Display size="display-xl" level={1}>
        {t("today.title")}
      </Display>
      <Text className="mt-2 font-body text-body-sm text-ink-soft">{hebrew ? `${hebrew} · ${gregorian}` : gregorian}</Text>
      {timesLine ? <Text className="mt-1 font-body text-body-sm text-ink-soft">{timesLine}</Text> : null}
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

  // Mobile layout: the whole flat-lay is on screen at scroll top, measured, not tuned (DESIGN.md section 3 "היום"
  // item 2). Paddings tuned to 390 and 360 broke with every extra line (N8, then the laundry, failure and Shabbat
  // times lines). Free space = from the hero's top edge to the floating bar's top, or to the scene's bottom (the tab
  // bar's top) when there is no bar, minus HERO_CLEARANCE.
  // The bar is there exactly when there is a suggestion to wear (barContent below).
  const hasBar = !desktop && plan.kind === "suggestion";
  // don't touch / a bar that left (worn) must not keep capping the hero with its old height, and one that comes back
  // (undo) must not be capped against a stale one before it is measured again.
  if (!hasBar && barHeight !== 0) setBarHeight(0);
  const measured =
    viewportHeight > 0 && mastheadHeight > 0 && aboveHeroHeight !== null && (!hasBar || barHeight > 0) && (!hasTabs || tabsHeight > 0);
  const heroTop = insets.top + MOBILE_TOP + mastheadHeight + (hasTabs ? tabsHeight : 0) + (aboveHeroHeight ?? 0) + MOBILE_HERO_GAP;
  const heroSpace = viewportHeight - (hasBar ? barHeight : 0) - heroTop - HERO_CLEARANCE;
  // 600-899, a window wide enough for side margins: the flat-lay is a centred card as wide as the space allows.
  // Below 600 it stays full-bleed and full width, and only its height is capped (FlatLay lays the composition out in
  // a centred 4:5 frame). Until measured, both render as before (column width, plain 4:5), so first paint does not jump.
  const card = !desktop && width >= CARD_MIN_WIDTH;
  const cardWidth = card && measured ? Math.max(HERO_MIN, Math.min(layout.maxContentWidth, heroSpace / FLAT_LAY_ASPECT)) : null;
  const measuredMax = !desktop && !card && measured ? Math.max(HERO_MIN * FLAT_LAY_ASPECT, heroSpace) : undefined;
  // A tab change cross-fades the two looks in motion.state (item 3). Their status lines can differ in height, so the
  // hero keeps the size it had for the duration and takes its new size when the old look is gone: the outgoing
  // garments never move. Layout state on purpose: the fade itself runs on shared values inside FlatLay.
  const [shownTab, setShownTab] = useState(selectedDate);
  const [heldSize, setHeldSize] = useState<{ max: number | undefined; card: number | null } | null>(null);
  if (shownTab !== selectedDate) {
    setShownTab(selectedDate);
    if (!reduceMotion) setHeldSize({ max: measuredMax, card: cardWidth });
  }
  useEffect(() => {
    if (!heldSize) return;
    const timer = setTimeout(() => setHeldSize(null), motion.stateMs);
    return () => clearTimeout(timer);
  }, [heldSize]);
  const heroMaxHeight = heldSize ? heldSize.max : measuredMax;
  const heroCardWidth = heldSize ? heldSize.card : cardWidth;

  const hero =
    pieces.length > 0 ? (
      // touchAction is also set in the gesture's own config (see useSwipeToSkip): RNGH 3.3 drops this one on update.
      <GestureDetector gesture={swipe.gesture} touchAction="pan-y">
        <View onLayout={swipe.onLayout}>
          <FlatLay
            pieces={pieces}
            onPressPiece={openPiece}
            // The legend rows below the hero are the same action in 01-04 order; the hero stops would be duplicates.
            pieceFocusable={false}
            instantKey={dayHistory.today.length}
            // A tab change replaces the whole outfit in place: a still cross-fade (DESIGN.md "שלב 4.1" item 3).
            fadeKey={selectedDate}
            radius={desktop || card ? "md" : "none"}
            accessibilityLabel={heroLabel}
            contentStyle={swipe.style}
            maxHeight={heroMaxHeight}
            onPieceNode={(id, node) => registerOrigin("today", id, node, { tone: flatLayTone(pieces), loose: true })}
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
          // The whole row opens the garment's sheet; the trailing cue says it swaps (DESIGN.md "שלב 5.1" item 3).
          accessibilityLabel={t("today.swapPiece", { name: p.name })}
          trailingIcon="swap_horiz"
        />
      ))}
    </View>
  ) : null;

  // The legend changes with the day's tab: a still fade, like the garments (item 3). Plain on a day without tabs.
  const legend = hasTabs && captions ? <CrossFade swapKey={selectedDate}>{captions}</CrossFade> : captions;

  const quote = explanation ? (
    <View>
      {/* Pull quote: the one sentence that says why, set in the display face under a 1px ink rule. */}
      <View className="border-t border-ink pt-4">
        <Display level={null}>{explanation.lead}</Display>
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
  // A sentence with proper names (Open-Meteo, Hebcal): no English uppercase from the Meta default, same as Profile.
  const credits = <Meta style={{ textTransform: "none" }}>{t("today.credits")}</Meta>;

  const wear = () => {
    if (plan.kind !== "suggestion") return;
    if (Platform.OS !== "web") void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    void actions.wear(plan.outfit, plan.source, effective, target).then(() => {
      resetSwaps();
      requestFocus("wear");
    });
  };
  const adjustActive = adjustment.temp_steps !== 0 || adjustment.formality_steps !== 0;

  const barContent: ReactNode =
    plan.kind === "suggestion" ? (
      <>
        {barStatusLine}
        <View className="flex-row items-center" style={{ gap: 8 }}>
          <View style={{ flex: 1 }} nativeID={FOCUS_WEAR}>
            <Button
              variant="primary"
              label={planned ? t(plannedKeys(planned.kind).wear) : t("today.wearing")}
              onPress={wear}
              disabled={busy}
              fullWidth
            />
          </View>
          <View nativeID={FOCUS_TUNE}>
            <Button
              variant="icon"
              outlined
              icon="tune"
              selected={adjustActive}
              accessibilityLabel={tuneLabel}
              onPress={() => {
                actions.dismissFailure();
                setAdjustOpen(true);
              }}
              disabled={busy}
            />
          </View>
        </View>
      </>
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
        <View nativeID={FOCUS_SKIP_STATUS} tabIndex={-1}>
          {statusLines}
        </View>
        {adjustNotes}
      </View>
    ) : null;

  const sheets = (
    <>
      <PieceSheet
        piece={piece?.item ?? null}
        open={pieceOpen}
        alternatives={plan.kind === "empty" ? null : options}
        heading={plan.kind === "worn" ? t("today.woreSomethingElse") : undefined}
        onSwap={(o) => {
          setPieceOpen(false);
          if (!piece) return;
          if (plan.kind === "worn") {
            // Correct what was recorded: one action, undo and wear behind it (useFeedback.correct). Focus follows as
            // after a wear: to the new status line's undo.
            const corrected = correctedPieces(shownItems, piece.item.id, o);
            const record = plan.record;
            void actions
              .correct(record, asCandidate(corrected, plan.req, pairWeights), "swap", effective, { date: record.date, dayType: contextTypeOf(days[sel]!) })
              .then(() => requestFocus("wear"));
            return;
          }
          setSwapsByDay((cur) => ({ ...cur, [selectedDate]: { ...cur[selectedDate], [piece.slot]: o.id } }));
        }}
        onOpenItem={(id) => {
          setPieceOpen(false);
          // The garment on the flat-lay is the shared element's origin: measured first, then the push.
          void flyFrom("today", id).then(() => router.push(`/item/${id}`));
        }}
        onClose={() => setPieceOpen(false)}
      />
      <AdjustSheet
        open={adjustOpen}
        onClose={() => setAdjustOpen(false)}
        adjustment={adjustment}
        onAdjust={adjust}
        onReset={resetAdjust}
        occasion={occasion}
        occasionTitle={t("today.occasion.title")}
        onOccasion={
          occasionChoosable
            ? (type) => {
                setAdjustOpen(false);
                resetSwaps();
                occasions.choose(selectedDate, type);
              }
            : undefined
        }
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
    // The whole surface fits under the top nav: the scene's height minus the 32 above and below, as a 4:5 width.
    // The day tabs above the column (and the 24 under them) come out of that height.
    const tabsSpace = hasTabs ? desktopTabsHeight + DESKTOP_TABS_GAP : 0;
    const heroMax =
      viewportHeight > 0 ? Math.min(DESKTOP_HERO_MAX, (viewportHeight - 2 * DESKTOP_HERO_PAD - tabsSpace) / FLAT_LAY_ASPECT) : DESKTOP_HERO_MAX;
    return (
      <View className="flex-1 bg-ivory" onLayout={(e) => setViewportHeight(e.nativeEvent.layout.height)}>
        <ScrollView contentContainerStyle={{ paddingTop: insets.top + DESKTOP_HERO_PAD, paddingBottom: 64 + insets.bottom }}>
          <View
            className="flex-row items-start"
            style={{ width: "100%", maxWidth: layout.maxContentWidthWide, alignSelf: "center", paddingHorizontal: DESKTOP_GUTTER, gap: DESKTOP_GAP }}
          >
            <View style={{ flex: 1, maxWidth: heroMax }}>
              {dayTabs ? (
                <View style={{ marginBottom: DESKTOP_TABS_GAP }} onLayout={(e) => setDesktopTabsHeight(e.nativeEvent.layout.height)}>
                  {dayTabs}
                </View>
              ) : null}
              <TabPanel idPrefix={DAY_TABS} selectedKey={selectedDate} active={hasTabs}>
                <Reveal index={1}>{hero ?? empty}</Reveal>
              </TabPanel>
            </View>
            <View style={{ flex: 1 }}>
              <Reveal index={0}>{masthead}</Reveal>
              {plannedForecast ? <View className="mt-6">{plannedForecast}</View> : null}
              {occasionLine ? <View className="mt-6">{occasionLine}</View> : null}
              {hintLine ? <View className="mt-6">{hintLine}</View> : null}
              {skipStatus && outfit ? (
                <View className="mt-6" nativeID={FOCUS_SKIP_STATUS} tabIndex={-1}>
                  {lineOf(skipStatus)}
                </View>
              ) : null}
              {outfit ? wornStatus("mt-6") : null}
              {noShoesLine ? <View className="mt-6">{noShoesLine}</View> : null}
              {outfit ? (
                <>
                  <Reveal index={2}>
                    <View className="mt-12">{legend}</View>
                  </Reveal>
                  <Reveal index={3}>
                    <View className="mt-12">{quote}</View>
                    {barContent ? (
                      <View className="mt-8">
                        <ActionBar floating={false}>{barContent}</ActionBar>
                      </View>
                    ) : null}
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

  return (
    <View className="flex-1 bg-ivory" onLayout={(e) => setViewportHeight(e.nativeEvent.layout.height)}>
      <View style={{ flex: 1, width: "100%", maxWidth: layout.maxContentWidth, alignSelf: "center" }}>
        <ScrollView
          contentContainerStyle={{
            // 24 above and 16 between masthead and hero (not 32 and 32): kept from when they were tuned so the flat-lay
            // cleared the bar; the cap is measured now, and these keep the default day's hero at full 4:5 size.
            paddingTop: insets.top + MOBILE_TOP,
            // Nothing may end under the floating bar: its measured height (a failure line joins it) plus air.
            // No bottom inset otherwise: the tab bar under the screen owns it.
            paddingBottom: (hasBar ? barHeight : 0) + UNDER_BAR,
          }}
        >
          <Reveal index={0}>
            <View className="px-5" onLayout={(e) => setMastheadHeight(e.nativeEvent.layout.height)}>
              {masthead}
            </View>
          </Reveal>
          {/* The day tabs stay at one place in the tree whatever the day holds, so focus stays on a tab across changes. */}
          {dayTabs ? (
            <Reveal index={1}>
              <View onLayout={(e) => setTabsHeight(e.nativeEvent.layout.height)}>
                <View className="mt-6">{dayTabs}</View>
              </View>
            </Reveal>
          ) : null}
          <TabPanel idPrefix={DAY_TABS} selectedKey={selectedDate} active={hasTabs}>
            {outfit ? (
              <>
                <Reveal index={1}>
                  {/* Everything between masthead and hero, measured as one block for the hero's cap. */}
                  <View onLayout={(e) => setAboveHeroHeight(e.nativeEvent.layout.height)}>
                    {forecastSlot}
                    {occasionLine ? <View className="mt-6 px-5">{occasionLine}</View> : null}
                    {hintLine ? <View className="mt-6 px-5">{hintLine}</View> : null}
                    {skipStatus ? (
                      <View className="mt-6 px-5" nativeID={FOCUS_SKIP_STATUS} tabIndex={-1}>
                        {lineOf(skipStatus)}
                      </View>
                    ) : null}
                    {wornStatus("mt-6 px-5")}
                    {noShoesLine ? <View className="mt-6 px-5">{noShoesLine}</View> : null}
                  </View>
                  <View style={{ marginTop: MOBILE_HERO_GAP, ...(heroCardWidth ? { width: heroCardWidth, alignSelf: "center" as const } : null) }}>
                    {hero}
                  </View>
                </Reveal>
                <Reveal index={2}>
                  <View className="mt-6 px-5">{legend}</View>
                </Reveal>
                <Reveal index={3}>
                  <View className="mt-12 px-5">{quote}</View>
                  <View className="mt-12 px-5">{credits}</View>
                </Reveal>
              </>
            ) : (
              <>
                {forecastSlot}
                <View className="px-5">
                  {empty}
                  <View className="mt-12">{credits}</View>
                </View>
              </>
            )}
          </TabPanel>
        </ScrollView>
        {hasBar ? (
          // safeArea off: Today always renders inside the tabs, whose bar below already takes the bottom inset.
          <ActionBar floating safeArea={false} onLayout={(e) => setBarHeight(e.nativeEvent.layout.height)}>
            {barContent}
          </ActionBar>
        ) : null}
      </View>
      {sheets}
    </View>
  );
}
