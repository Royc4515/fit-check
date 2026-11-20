import {
  combineAdjustments,
  learnedAdjustment,
  NO_ADJUSTMENT,
  swapOptions,
  withSavedPairs,
  type DayAdjustment,
  type DayWeather,
  type PairWeights,
  type SavedOutfitSignal,
} from "@fit-check/engine";
import type { Item, Slot, StylistInput, StylistOutput } from "@fit-check/schema";
import * as Haptics from "expo-haptics";
import { useRouter } from "expo-router";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { AccessibilityInfo, Platform, ScrollView, Text, View, useWindowDimensions } from "react-native";
import { GestureDetector } from "react-native-gesture-handler";
import { useReducedMotion } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Reveal } from "../../components/editorial/Reveal";
import {
  ACTION_BAR_HEIGHT,
  ActionBar,
  Button,
  CrossFade,
  Display,
  EmptyState,
  FLAT_LAY_ASPECT,
  FlatLay,
  FlatLayPlaceholder,
  flatLayTone,
  LegendRow,
  Meta,
  StatusLine,
  TabPanel,
  type FlatLayPiece,
  type StatusVariant,
} from "../../components/ui";
import { fitFlatLay, HERO_MIN } from "../../components/ui/flatLayFit";
import { reloadDayContext, type DayContext } from "../../data/dayContext";
import type { FeedbackHistory } from "../../data/feedback";
import { chainTabLabels } from "../../data/shabbatTimes";
import { DayTabs } from "./DayTabs";
import { plannedKeys, tabKey } from "./dayInForce";
import type { OccasionsState } from "../../data/occasions";
import { correctionFailure } from "../../data/correction";
import type { FeedbackActions, FeedbackState, FeedbackTarget, Laundered } from "../../data/useFeedback";
import { layout, motion } from "../../theme/tokens";
import { flyFrom, registerOrigin } from "../item/transition";
import { TryOnSheet } from "../tryon/TryOnSheet";
import { tryonItemsOf } from "../tryon/model";
import { AdjustSheet, type Adjust } from "./AdjustSheet";
import { explainOutfit } from "./explain";
import { settingGetNow, settingGet, settingSet } from "../../data/kv";
import { asCandidate, contextTypeOf, rulesStillFit, weatherStillFits, type DayInput, type Swaps, type TodayPlan } from "./outfit";
import { bookmarkFailureAction, bookmarkIntent, shownSaved, type BookmarkIntent } from "./bookmark";
import { initialLearn, initialWeatherInForce, learnedFrom, nextLearn, nextWeatherInForce, skipCount, weatherInForceFor, type WeatherInForce } from "./learning";
import { PieceSheet } from "./PieceSheet";
import {
  DAY_TABS,
  DESKTOP_GAP,
  DESKTOP_GUTTER,
  DESKTOP_HERO_MAX,
  DESKTOP_HERO_PAD,
  DESKTOP_TABS_GAP,
  MOBILE_HERO_GAP,
  MOBILE_TOP,
  UNDER_BAR,
} from "./frameLayout";
import { ltr, Masthead, PlannedForecastLine } from "./Masthead";
import type { BookmarkApi } from "./useBookmark";
import { defaultAdjustment, occasionInEffect, occasionMayApply, planDays } from "./plans";
import { correctedPieces, outfitIndex, SLOT_ORDER, tapHintFit, type HintFit } from "./pieces";
import { useSwipeToSkip } from "./useSwipeToSkip";

/** What the calendar says a day is, as the engine plans it: the part of DayInput a late calendar can change. */
type DayRules = Pick<DayInput, "dayType" | "festive" | "yomKippur">;

/**
 * What a day is planned with: its forecast and the calendar's rules for it. Held in force per tab like the forecast
 * alone was (learning.ts WeatherInForce), so a forecast or a calendar that arrives after an outfit was shown never
 * re-ranks it; `rules` is null for a date that is not on screen (never planned).
 */
type Conditions = { weather: DayWeather | null; rules: DayRules | null };

const sameRules = (a: DayRules | null, b: DayRules | null) =>
  a === b || (a !== null && b !== null && a.dayType === b.dayType && !!a.festive === !!b.festive && !!a.yomKippur === !!b.yomKippur);

/** Two forecasts of a day say the same thing on screen and to the engine (null is "no forecast"). */
const sameWeather = (a: DayWeather | null, b: DayWeather | null) =>
  a === b ||
  (a !== null &&
    b !== null &&
    a.temp_min_c === b.temp_min_c &&
    a.temp_max_c === b.temp_max_c &&
    a.rain_probability === b.rain_probability &&
    a.sky === b.sky);

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
  /** A correction after wearing that did not complete (useFeedback `correction`). */
  correction?: FeedbackState["correction"];
  /**
   * The local time `HH:MM` when the screen opened (an occasion after havdalah). Data, not a clock read here, so the
   * choice is testable.
   */
  clock: string;
  /**
   * The tab Today opens on (dayInForce), decided once by the container when the day's records and planned days were
   * known: wearing today's outfit, or planned days that arrive later, must not pull the screen to another tab.
   */
  openingTab: string;
  /** A tab chosen by hand (in the frame or here), kept by the container while the screen is mounted; null for none. */
  chosenTab: string | null;
  onChooseTab: (date: string) => void;
  /** The AI stylist (stage B). Absent or returning null means the engine's order and template text are used. */
  stylist?: (input: StylistInput) => Promise<StylistOutput | null>;
  /** What is on each date on screen, and how to change it (DESIGN.md "שלב 4.5"). */
  occasions: OccasionsState;
  /** Saving the shown outfit to the collection, and the saved outfits it is compared with (DESIGN.md "שלב 5.2" item 6). */
  bookmark: BookmarkApi;
  /**
   * The saved outfits the engine learns from (DESIGN.md "שלב 5.2" item 8), or null while they have not been read
   * (loading, or failed). Taken in only when the outfit is regenerated anyway (learning.ts), never on arrival.
   */
  savedOutfits?: readonly SavedOutfitSignal[] | null;
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

/** DOM ids of the places focus is sent to after an action (web only; see the focus effect in TodayView). */
const FOCUS_WORN_STATUS = "today-worn-status";
const FOCUS_SKIP_STATUS = "today-skip-status";
const FOCUS_WEAR = "today-wear";
/** The legend: focus goes to its first row after "got it" on the tap hint. */
const FOCUS_LEGEND = "today-legend";
/**
 * Height the tap hint takes above the hero: a one-line StatusLine (44) and the 24 above it. Used to decide whether it
 * fits before it is drawn (DESIGN.md "שלב 5.1" item 2).
 */
const HINT_BLOCK = 68;
/** The adjust button, where an occasion is chosen: focus goes there after the occasion line's "cancel". */
const FOCUS_TUNE = "today-tune";
/** The first thing in a container that a keyboard can reach: react-native-web gives every live pressable tabindex 0. */
/** A little longer than the sheet's critically damped close spring takes to settle (motion.spring). */
const SHEET_SETTLE_MS = 700;
const FIRST_TABBABLE = '[tabindex="0"]:not([aria-disabled="true"])';
/** Device flag: the one-time "tap any garment" line has been acted on (DESIGN.md "שלב 5.1" item 2). */
const TAP_HINT_KEY = "fitcheck:tap-hint-seen";

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
export function TodayView({
  items,
  pairWeights,
  day,
  history,
  actions,
  busy,
  failedOn,
  laundered,
  correction = null,
  stylist,
  clock,
  openingTab,
  chosenTab,
  onChooseTab,
  occasions,
  bookmark,
  savedOutfits = null,
}: Props) {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const desktop = width >= layout.desktopMin;
  const reduceMotion = useReducedMotion();

  // Today first, then each phone-free day that today's candle lighting opens (DESIGN.md "שלב 4.1"). Without candles
  // the list is just today and the screen is exactly what it was before the tabs.
  const dates = useMemo(() => [day.date, ...day.chain.map((d) => d.date)], [day.date, day.chain]);
  const tabLabels = useMemo(() => chainTabLabels(day.chain), [day.chain]);
  const hasTabs = day.chain.length > 0;
  // The opening tab is decided once by the container (dayInForce); a tab chosen by hand lasts while the screen is
  // mounted, no longer (item 3). A tab that is not (or no longer) on screen falls back to today.
  const selectedDate = [chosenTab, openingTab].find((d) => d !== null && dates.includes(d)) ?? day.date;
  const setChosenTab = onChooseTab;
  const sel = Math.max(0, dates.indexOf(selectedDate));
  const planned = sel > 0 ? day.chain[sel - 1]! : null;

  // What each date is as the calendar says now (null: not on screen). The facts on screen (dates, times, the names of
  // the days) always follow these; the outfits follow the conditions in force below.
  const liveRulesOf = (date: string): DayRules | null => {
    if (date === day.date) return { dayType: day.dayType, festive: day.festive, yomKippur: day.yomKippur };
    const d = day.chain.find((c) => c.date === date);
    return d ? { dayType: d.dayType, festive: false, yomKippur: d.yomKippur } : null;
  };
  const liveOf = (date: string): Conditions => ({
    weather: date === day.date ? day.weather : (day.chain.find((d) => d.date === date)?.weather ?? null),
    rules: liveRulesOf(date),
  });
  // Session-only nudges and swaps (see engine/adjust.ts), per day. Swaps belong to one suggestion: anything that
  // changes the suggestion (a nudge, a skip) clears them, or a swapped shirt would be pasted onto a different outfit.
  const [adjustments, setAdjustments] = useState<Readonly<Record<string, DayAdjustment>>>({});
  const [swapsByDay, setSwapsByDay] = useState<Readonly<Record<string, Swaps>>>({});
  // The saved outfits the engine learns from: fixed when the screen opens, replaced only by a new skip or a nudge, so
  // a list that arrives after the first paint never re-ranks the outfit on screen (learning.ts). Updated during render
  // (React's "state from the previous render" pattern), so a skip and its new list land in the same frame.
  const skips = skipCount(history);
  const [learn, setLearn] = useState(() => initialLearn(skips, adjustments, savedOutfits));
  const learnNow = nextLearn(learn, skips, adjustments, savedOutfits);
  if (learnNow !== learn) setLearn(learnNow);
  // The forecast and the calendar's rules each tab's outfit is planned with, the same way: fixed when that tab's outfit
  // is first generated (today's when the screen opened; Index waited for them at most WEATHER_GRACE_MS and
  // CALENDAR_GRACE_MS), replaced only by a skip, a nudge, a different occasion or "update the suggestion" on that day,
  // and brought back by an undo (learning.ts nextWeatherInForce). Changing tabs is not a trigger. A forecast or a
  // calendar that answers later updates every printed fact at once and never re-ranks an outfit already shown; if it
  // makes that outfit wrong, a line says so.
  const [refresh, setRefresh] = useState(0);
  // The stored occasion, not the one in effect: whether it applies depends on the day's rules, which are in force here.
  const storedOccasion = occasions.byDate[day.date]?.type ?? null;
  const weatherTriggers = { skips, adjustments, tab: selectedDate, today: day.date, occasion: storedOccasion, refresh };
  const [weatherState, setWeatherState] = useState<WeatherInForce<Conditions>>(() => initialWeatherInForce(weatherTriggers, liveOf));
  const weatherNow = nextWeatherInForce(weatherState, weatherTriggers, liveOf);
  if (weatherNow !== weatherState) setWeatherState(weatherNow);
  const inForceOf = (date: string): Conditions => weatherInForceFor(weatherNow, date, liveOf);
  const rulesOf = (date: string): DayRules => inForceOf(date).rules ?? liveRulesOf(date) ?? { dayType: "weekday", festive: false, yomKippur: false };
  const rulesList = dates.map(rulesOf);
  const rulesKey = JSON.stringify(rulesList);
  // Whether today's occasion may decide its look now: a weekday, or Shabbat / a holiday after its havdalah (4.5 item 3),
  // by the day type the outfit is planned with.
  const todayRules = rulesOf(day.date);
  const todayOccasion = useMemo(
    () => ({ tab: "today" as const, dayType: todayRules.dayType, havdalahToday: day.end?.day === "today" ? day.end.time : null, now: clock }),
    [todayRules.dayType, day.end, clock]
  );
  // The days as they are planned: each date with the calendar's rules in force and the live forecast (the forecast in
  // force is put in by planningDays below; `days` keeps the live one for the printed numbers).
  const days = useMemo<DayInput[]>(
    () =>
      dates.map((date, k) => {
        const rules = rulesList[k]!;
        const weather = date === day.date ? day.weather : (day.chain.find((d) => d.date === date)?.weather ?? null);
        // A planned day's tab is planned by Shabbat's or the holiday's rules, never by an occasion (4.5 item 3).
        return k === 0
          ? { date, weather, ...rules, occasion: occasionInEffect(occasions.byDate[day.date]?.type, todayOccasion) }
          : { date, weather, dayType: rules.dayType, yomKippur: rules.yomKippur };
      }),
    // rulesKey carries rulesList by value, so a new list with the same rules does not re-plan.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [dates, rulesKey, day, occasions.byDate, todayOccasion]
  );
  // A planned day's answers go on its date; a day with an occasion records the occasion's context (4.5 item 6).
  const occasion = days[sel]!.occasion ?? null;
  const target: FeedbackTarget | undefined =
    planned || occasion ? { date: selectedDate, dayType: contextTypeOf(days[sel]!) } : undefined;
  const failed = failedOn !== null && failedOn === selectedDate;
  const plannedWeather = days.map((d) => inForceOf(d.date).weather);
  const plannedKey = JSON.stringify(plannedWeather);
  const planningDays = useMemo<DayInput[]>(
    () => days.map((d, k) => ({ ...d, weather: plannedWeather[k] ?? null })),
    // plannedKey carries plannedWeather by value, so a new array with the same forecasts does not re-plan.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [days, plannedKey]
  );
  // don't touch / every engine call on this screen scores with these, never with `pairWeights`: a swap list or a
  // corrected wear ranked without the saved bonus would disagree with the outfit above it. And never the other way:
  // the learned weights written by a wear (useFeedback) stay `pairWeights`, or the bonus would be banked as wears.
  const scoringWeights = useMemo(() => withSavedPairs(pairWeights, learnedFrom(learnNow)), [pairWeights, learnNow]);
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
  // "Got it": the line leaves and focus would drop to the page; send it to the first legend row, the lasting cue.
  const gotHint = () => {
    dismissHint();
    if (Platform.OS !== "web") return;
    requestAnimationFrame(() => {
      const box = document.getElementById(FOCUS_LEGEND);
      box?.querySelector<HTMLElement>(FIRST_TABBABLE)?.focus();
    });
  };
  const [adjustOpen, setAdjustOpen] = useState(false);
  const [tryOnOpen, setTryOnOpen] = useState(false);
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
  /** A day's name in the explanation: the holiday's own name on a Yom Tov, else its day type. */
  const dayLabelOf = (k: number, lng: "he" | "en" = locale) => {
    const d = days[k]!;
    // The explanation names the occasion instead of the day type (DESIGN.md "שלב 4.5" item 2).
    if (d.occasion) return t(`today.occasion.type.${d.occasion}`, { lng });
    // The holiday's name only while the outfit is planned as that holiday: a weekday outfit drawn before the calendar
    // came is not called "for the holiday".
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
    const holiday = d.dayType === "holiday" || d.festive ? (k === 0 ? day.holiday : (day.chain[k - 1]?.holiday ?? null)) : null;
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
        pairWeights: scoringWeights,
        days: planningDays,
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
    [items, scoringWeights, planningDays, day, history, effectiveByDay, swapsByDay, answers, t]
  );
  const selected = plans[sel]!;
  const base = selected.base;
  const plan = selected.plan;
  const dayHistory = selected.history;
  // The forecast the selected day's outfit was planned with: what the stylist is told and the explanation names.
  const dayWeather = inForceOf(selectedDate).weather;
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
    () => (plan.kind !== "empty" && piece ? swapOptions(selected.pool, plan.req, scoringWeights, shownItems, piece.slot) : []),
    [plan, piece, selected.pool, scoringWeights, shownItems]
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

  // The selected day's live forecast: every temperature the screen prints is this one (the numbers are facts); only the
  // outfit stays as it was planned (dayWeather).
  const liveSelWeather = liveOf(selectedDate).weather;
  const template = outfit ? explainOutfit(t, { weather: liveSelWeather, dayType: days[sel]!.dayType, occasion: occasion ?? undefined }, outfit, dayLabel) : null;
  // The stylist's sentence replaces the template lead only for the outfit it actually chose (not after a swap), and
  // only while the forecast it was told is still the live one: its words may carry the older numbers.
  const explanation =
    template && plan.kind === "suggestion" && plan.styled && styled && sameWeather(dayWeather, liveSelWeather)
      ? { ...template, lead: locale === "en" ? styled.explanation_en : styled.explanation_he }
      : template;

  const ordered = outfit ? SLOT_ORDER.flatMap((slot) => outfit.items.filter((i) => i.slot === slot)) : [];
  const typeOf = (sub: string) => t(`item.subcategory.${sub}`);
  // The bookmark of the outfit as shown on the selected tab, after swaps (DESIGN.md "שלב 5.2" item 6). Garment sets are
  // compared order-free by the data layer's own key; which write a press makes is decided in bookmark.ts.
  const intent: BookmarkIntent =
    outfit && plan.kind !== "empty"
      ? bookmarkIntent({
          pieces: ordered.map((p) => ({ item_id: p.id, slot: p.slot })),
          saved: bookmark.saved,
          wornOutfitId: plan.kind === "worn" ? plan.record.outfitId : null,
          date: selectedDate,
          contextType: contextTypeOf(days[sel]!),
          source: plan.kind === "suggestion" ? plan.source : "daily",
        })
      : { kind: "hidden" };
  const bookmarked = shownSaved(intent, bookmark.pending);
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
    bookmark.dismissFailure();
    setPiece({ slot, item });
    setPieceOpen(true);
  };

  /** What the user already told us today, each with its undo. Quiet lines, never a toast (DESIGN.md: no overlays). */
  const statuses: StatusItem[] = [];
  if (plan.kind === "worn") {
    const record = plan.record;
    const wornMessage = planned ? t(plannedKeys(planned.kind).worn) : t("today.status.worn");
    statuses.push({ key: "worn", variant: "ok", message: wornMessage, action: { label: t("today.undo"), onPress: () => void actions.undo(record).then(() => requestFocus("undo")) } });
    if (laundered && laundered.wearId === record.wearId && laundered.itemIds.length > 0) {
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
  // A correction that did not complete says which step failed and what stands (DESIGN.md "שלב 5.1" item 1).
  if (correction && correction.date === selectedDate) {
    const { messageKey } = correctionFailure(correction.stage);
    statuses.push({ key: "correction", variant: "error", message: t(messageKey), action: { label: t("common.retry"), onPress: correction.retry } });
  }
  if (failed) statuses.push({ key: "failed", variant: "error", message: t("today.status.failed") });
  // A failed save or removal stays with the outfit it was for, on its day's tab, with "try again" (item 6).
  // "Try again" never replays the press that failed: it presses the CURRENT intent (a save that failed, then a wear,
  // now offers "mark this worn row as saved"). A line whose outfit or day is gone, or whose wish is already met, is
  // not shown (bookmarkFailureAction).
  const bookmarkFailure = bookmark.failure;
  if (bookmarkFailure && intent.kind !== "hidden" && bookmarkFailureAction(bookmarkFailure, intent, selectedDate) === "show") {
    const current = intent;
    statuses.push({
      key: "bookmark",
      variant: "error",
      message: t(bookmarkFailure.wantSaved ? "today.bookmark.saveFailed" : "today.bookmark.removeFailed"),
      action: { label: t("common.retry"), onPress: () => void bookmark.press(current, selectedDate) },
    });
  }

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
  // What stays in the bar is a failed "wearing it" or a failed bookmark, beside the buttons they belong to.
  const barStatusLines = plan.kind === "suggestion" ? statuses.filter((s) => s.key === "failed" || s.key === "bookmark").map(lineOf) : [];
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
  // A forecast that arrived after this outfit was drawn and makes it wrong by the engine's own weather rules (a piece
  // too light or too warm for the new range, a layer missing or out of place): said once, above the hero, with the
  // way to a new outfit. Never swapped silently; a forecast that only changes the ranking is not mentioned (it is
  // taken in at the next change). Rain alone is not a rule in the engine, so it does not raise this line.
  const plannedSelWeather = dayWeather;
  // The same for the calendar: it arrived after the outfit was drawn and gives the day rules the outfit breaks
  // (today turned out to be a holiday, or Yom Kippur). Judged on the live rules with the live forecast.
  const liveSelRules = liveRulesOf(selectedDate);
  const plannedSelRules = inForceOf(selectedDate).rules;
  const liveSelDay: DayInput | null = liveSelRules ? { ...days[sel]!, ...liveSelRules, weather: liveSelWeather } : null;
  // Not memoized: the engine is asked only while the two differ, which is rare and brief.
  const calendarOutdated =
    plan.kind === "suggestion" &&
    liveSelDay !== null &&
    !sameRules(plannedSelRules, liveSelRules) &&
    !rulesStillFit({ outfit: plan.items, day: liveSelDay, adjustment: effective });
  const forecastOutdated =
    !calendarOutdated &&
    plan.kind === "suggestion" &&
    liveSelWeather !== null &&
    !sameWeather(plannedSelWeather, liveSelWeather) &&
    !weatherStillFits({ outfit: plan.items, pool: selected.pool, day: { ...days[sel]!, weather: liveSelWeather }, adjustment: effective });
  // don't touch / no outfit on screen (the older forecast or the civil calendar left nothing to suggest): there is
  // nothing to keep still, so a newer forecast or calendar is taken in at once. Found in the browser check: a warm
  // stored forecast emptied the day and the late cold one was never used. Guarded by the conditions differing, which
  // the refresh itself ends: no loop.
  if (
    plan.kind === "empty" &&
    ((liveSelWeather !== null && !sameWeather(plannedSelWeather, liveSelWeather)) || (liveSelRules !== null && !sameRules(plannedSelRules, liveSelRules)))
  )
    setRefresh((n) => n + 1);
  const updateAction = {
    label: t("today.forecastUpdate"),
    onPress: () => {
      resetSwaps();
      setRefresh((n) => n + 1);
    },
  };
  const forecastUpdatedLine = calendarOutdated ? (
    <StatusLine variant="info" message={t("today.calendarUpdated")} action={updateAction} disabled={busy} />
  ) : forecastOutdated ? (
    <StatusLine variant="info" message={t("today.forecastUpdated")} action={updateAction} disabled={busy} />
  ) : null;
  // The Hebrew calendar is not known (no stored answer, and none in time): with the observance switch on, the outfit
  // was drawn by the civil calendar alone and may be wrong for a holiday or its eve; say so, plainly, above the hero
  // (DESIGN.md "היום" item 1). "Try again" asks Hebcal again; the line leaves when the calendar arrives.
  const calendarMissingLine =
    day.observes && !day.calendar.known ? (
      <StatusLine
        variant="info"
        message={t(day.weekday === 6 ? "today.calendarMissingShabbat" : "today.calendarMissing")}
        action={{ label: t("common.retry"), onPress: reloadDayContext }}
        disabled={busy}
      />
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

  // The day tabs (DESIGN.md "שלב 4.1" item 2): today, then each planned day. Moving between them with the keyboard
  // keeps focus on the tab (TextTabs stays mounted in one place in every state, see the layouts below).
  const dayTabs = hasTabs ? <DayTabs day={day} value={selectedDate} onChange={setChosenTab} inset={desktop ? 0 : layout.gutter} idPrefix={DAY_TABS} /> : null;
  // A planned day's own forecast, named by its day (item 8). Mobile: it opens the measured block above the hero,
  // inside the day's panel, held on the today tab too so a tab change does not move the hero by a line's height.
  const plannedForecast = planned ? <PlannedForecastLine planned={planned} /> : null;
  const forecastSlot = hasTabs ? (
    <View className="mt-4 px-5">
      <PlannedForecastLine planned={planned} />
    </View>
  ) : null;

  const pressBookmark = () => {
    if (intent.kind === "hidden") return;
    actions.dismissFailure();
    void bookmark.press(intent, selectedDate);
  };
  // Disabled, in its "not saved" look, until the saved outfits have been read: a press before then could not tell an
  // outfit that is saved from one that is not. Also while a wear is being written, so the two cannot race.
  const bookmarkButton =
    intent.kind === "hidden" ? null : (
      <Button
        variant="icon"
        icon={bookmarked ? "bookmark_fill" : "bookmark"}
        selected={bookmarked}
        // When the saved list could not be read the label also says why the button is disabled (no visible line;
        // react-native-web drops accessibilityHint and aria-description on a Pressable, so it rides on the label).
        accessibilityLabel={[bookmarked ? t("today.bookmark.remove") : t("today.bookmark.save"), bookmark.unavailable ? t("today.bookmark.unavailable") : null]
          .filter(Boolean)
          .join(". ")}
        onPress={pressBookmark}
        disabled={!bookmark.ready || busy}
      />
    );
  // The polite announcement of a finished save or removal (item 6): the icon changing shape is for the eyes. Web reads
  // this live region; native speaks it through the accessibility service.
  const announcement = bookmark.announcement;
  const [announceCleared, setAnnounceCleared] = useState(0);
  const announceText = announcement && announcement.n !== announceCleared ? t(announcement.kind === "saved" ? "today.bookmark.saved" : "today.bookmark.removed") : "";
  useEffect(() => {
    if (!announcement) return;
    if (Platform.OS !== "web") void AccessibilityInfo.announceForAccessibility(t(announcement.kind === "saved" ? "today.bookmark.saved" : "today.bookmark.removed"));
    // Emptied after a while so a reader's browse mode does not find a stale sentence; set from the timer, not here.
    const timer = setTimeout(() => setAnnounceCleared(announcement.n), 4000);
    return () => clearTimeout(timer);
  }, [announcement, t]);
  const announceLine = (
    <Text
      accessibilityLiveRegion={Platform.OS === "web" ? "polite" : "none"}
      style={{ position: "absolute", width: 1, height: 1, overflow: "hidden" }}
      pointerEvents="none"
    >
      {announceText}
    </Text>
  );

  // Drawn once the first generation has happened, so nothing is waited for any more: a line still without its data
  // says so (Masthead).
  const masthead = (
    <Masthead day={day} titleAction={bookmarkButton} weatherSettled calendarSettled>
      {announceLine}
    </Masthead>
  );

  // Mobile layout: the whole flat-lay is on screen at scroll top, measured, not tuned (DESIGN.md section 3 "היום"
  // item 2). Paddings tuned to 390 and 360 broke with every extra line (N8, then the laundry, failure and Shabbat
  // times lines). Free space = from the hero's top edge to the floating bar's top, or to the scene's bottom (the tab
  // bar's top) when there is no bar, minus HERO_CLEARANCE.
  // The older forecast left nothing to suggest while the fresh one is still on its way: the frame stays (dates, weather
  // with its stored-forecast note, tabs) and only the hero keeps its loading state, saying what it waits for. Bounded by
  // the request's own timeout; when it answers the day takes it at once (the empty-day rule above), when it fails the
  // empty state is the true answer.
  const awaitingForecast = plan.kind === "empty" && day.forecast.pending;
  // The bar is there exactly when there is a suggestion to wear (barContent below).
  const hasBar = !desktop && plan.kind === "suggestion";
  // don't touch / a bar that left (worn) must not keep capping the hero with its old height, and one that comes back
  // (undo) must not be capped against a stale one before it is measured again.
  if (!hasBar && barHeight !== 0) setBarHeight(0);
  const measured =
    viewportHeight > 0 && mastheadHeight > 0 && aboveHeroHeight !== null && (!hasBar || barHeight > 0) && (!hasTabs || tabsHeight > 0);
  const heroTop = insets.top + MOBILE_TOP + mastheadHeight + (hasTabs ? tabsHeight : 0) + (aboveHeroHeight ?? 0) + MOBILE_HERO_GAP;
  // 600-899, a window wide enough for side margins: the flat-lay is a centred card as wide as the space allows.
  // Below 600 it stays full-bleed and full width, and only its height is capped (FlatLay lays the composition out in
  // a centred 4:5 frame). Until measured, both render as before (column width, plain 4:5), so first paint does not jump.
  const {
    card,
    cardWidth,
    maxHeight: measuredMax,
    space: heroSpace,
  } = fitFlatLay({ measured, desktop, width, viewportHeight, heroTop, bottomReserved: hasBar ? barHeight : awaitingForecast ? ACTION_BAR_HEIGHT : 0 });
  // The one-time cue that garments can be tapped (5.1 item 2), until the first tap on a garment or "got it". It is
  // shown only when the flat-lay stays above its floor with it (it must never push garments under the bar); when it
  // does not fit it waits for another visit, the flag unset. Decided once from the space measured without it, then
  // only ever withdrawn (a line that arrives later, say an occasion, can take its room): no layout loop.
  const [hintFit, setHintFit] = useState<HintFit>(null);
  // And only once the day's occasion read has answered (or failed): a line arriving after the hint would take its room
  // and withdraw it on its own a moment later.
  const hintWanted = showHint && outfit !== null && occasions.settled;
  const floorSpace = HERO_MIN * FLAT_LAY_ASPECT;
  const nextHintFit = hintWanted ? tapHintFit({ decided: hintFit, measured, space: heroSpace, floor: floorSpace, hintBlock: HINT_BLOCK, desktop }) : hintFit;
  if (nextHintFit !== hintFit) setHintFit(nextHintFit);
  const hintLine =
    hintWanted && hintFit === "show" ? (
      <StatusLine variant="info" message={t("today.tapHint")} action={{ label: t("today.tapHintOk"), onPress: gotHint }} />
    ) : null;
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
  const placeholder = awaitingForecast ? (
    <FlatLayPlaceholder maxHeight={desktop ? undefined : heroMaxHeight} radius={desktop || card ? "md" : "none"} label={t("today.awaitingForecast")} />
  ) : null;

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
          accessibilityLabel={t("today.swapPiece", { type: typeOf(p.subcategory), name: p.name })}
          trailingIcon="swap_horiz"
        />
      ))}
    </View>
  ) : null;

  // The legend changes with the day's tab: a still fade, like the garments (item 3). Plain on a day without tabs.
  const legend = hasTabs && captions ? <CrossFade swapKey={selectedDate}>{captions}</CrossFade> : captions;
  // "On a figure" (DESIGN.md "שלב 5.3" item 1): a text button under the legend, on the outfit as shown (after swaps),
  // suggested or worn. Absent when the outfit cannot be drawn (no shoes on Yom Kippur, incomplete): the server needs
  // a top, bottom and shoes. It sits below the hero and legend, so the flat-lay's measured space is untouched.
  const tryOnGarments =
    outfit && plan.kind !== "empty" && tryonItemsOf(ordered.map((p) => ({ id: p.id, slot: p.slot })))
      ? ordered.map((p) => ({ id: p.id, slot: p.slot, label: `${typeOf(p.subcategory)} ${p.name}`, name: p.name }))
      : null;
  const legendBlock = legend ? (
    <View>
      <View nativeID={FOCUS_LEGEND}>{legend}</View>
      {tryOnGarments ? (
        <View className="items-start">
          <Button variant="text" label={t("tryon.entry")} onPress={() => setTryOnOpen(true)} />
        </View>
      ) : null}
    </View>
  ) : null;

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
    bookmark.dismissFailure();
    // Which row the wear is recorded on (a saved outfit's own, else a new one) is decided inside the write, from a
    // settled saved list (useFeedback `resolveRow`).
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
                bookmark.dismissFailure();
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
      <TryOnSheet open={tryOnOpen && tryOnGarments !== null} onClose={() => setTryOnOpen(false)} garments={tryOnGarments ?? []} />
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
              .correct(record, asCandidate(corrected, plan.req, scoringWeights), "swap", effective, { date: record.date, dayType: contextTypeOf(days[sel]!) })
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
                <Reveal index={1}>{hero ?? placeholder ?? empty}</Reveal>
              </TabPanel>
            </View>
            <View style={{ flex: 1 }}>
              {masthead}
              {plannedForecast ? <View className="mt-6">{plannedForecast}</View> : null}
              {calendarMissingLine ? <View className="mt-6">{calendarMissingLine}</View> : null}
              {occasionLine ? <View className="mt-6">{occasionLine}</View> : null}
              {forecastUpdatedLine ? <View className="mt-6">{forecastUpdatedLine}</View> : null}
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
                    <View className="mt-12">{legendBlock}</View>
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
          {/* No entrance for the masthead and the tabs: the frame drew them in this very place before the outfit came
              (TodayFrame), and they must not fade in a second time. */}
          <View className="px-5" onLayout={(e) => setMastheadHeight(e.nativeEvent.layout.height)}>
            {masthead}
          </View>
          {/* The day tabs stay at one place in the tree whatever the day holds, so focus stays on a tab across changes. */}
          {dayTabs ? (
            <View onLayout={(e) => setTabsHeight(e.nativeEvent.layout.height)}>
              <View className="mt-6">{dayTabs}</View>
            </View>
          ) : null}
          <TabPanel idPrefix={DAY_TABS} selectedKey={selectedDate} active={hasTabs}>
            {outfit ? (
              <>
                <Reveal index={1}>
                  {/* Everything between masthead and hero, measured as one block for the hero's cap. */}
                  <View onLayout={(e) => setAboveHeroHeight(e.nativeEvent.layout.height)}>
                    {forecastSlot}
                    {calendarMissingLine ? <View className="mt-6 px-5">{calendarMissingLine}</View> : null}
                    {occasionLine ? <View className="mt-6 px-5">{occasionLine}</View> : null}
                    {forecastUpdatedLine ? <View className="mt-6 px-5">{forecastUpdatedLine}</View> : null}
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
                  <View className="mt-6 px-5">{legendBlock}</View>
                </Reveal>
                <Reveal index={3}>
                  <View className="mt-12 px-5">{quote}</View>
                  <View className="mt-12 px-5">{credits}</View>
                </Reveal>
              </>
            ) : placeholder ? (
              <Reveal index={1}>
                <View onLayout={(e) => setAboveHeroHeight(e.nativeEvent.layout.height)}>
                  {forecastSlot}
                  {calendarMissingLine ? <View className="mt-6 px-5">{calendarMissingLine}</View> : null}
                </View>
                <View style={{ marginTop: MOBILE_HERO_GAP, ...(heroCardWidth ? { width: heroCardWidth, alignSelf: "center" as const } : null) }}>
                  {placeholder}
                </View>
              </Reveal>
            ) : (
              <>
                {forecastSlot}
                <View className="px-5">
                  {calendarMissingLine ? <View className="mt-6">{calendarMissingLine}</View> : null}
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
