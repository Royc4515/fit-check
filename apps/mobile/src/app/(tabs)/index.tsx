import type { PairWeights } from "@fit-check/engine";
import type { Item } from "@fit-check/schema";
import { useFocusEffect } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { WardrobeGate } from "../../components/WardrobeGate";
import { addDays } from "../../data/calendarWindow";
import { localTime, type DayContext } from "../../data/dayContext";
import { useDayContext } from "../../data/useDayContext";
import { useFeedback } from "../../data/useFeedback";
import { useOccasions } from "../../data/occasions";
import { CHAIN_MAX_DAYS } from "../../data/shabbatTimes";
import { requestStyle } from "../../data/stylist";
import type { WardrobeData } from "../../data/wardrobe";
import { useWardrobe, type WardrobeState } from "../../data/WardrobeProvider";
import { sessionUserId, useSession } from "../../features/auth/SessionProvider";
import { listNow, recordWornChange, refreshOutfits, useSavedOutfits, whenSettled } from "../../features/outfits/store";
import { resolveWearRow } from "../../features/today/bookmark";
import { dayInForce } from "../../features/today/dayInForce";
import { CALENDAR_GRACE_MS, firstSuggestion, SAVED_LIST_GRACE_MS, WEATHER_GRACE_MS } from "../../features/today/learning";
import { TodayFrame } from "../../features/today/TodayFrame";
import { TodayView } from "../../features/today/TodayView";
import { useBookmark } from "../../features/today/useBookmark";

const NO_ITEMS: Item[] = [];
const NO_WEIGHTS: PairWeights = new Map();
const noPatch = () => undefined;

/**
 * Today: draws its frame as soon as the device's own data allows (the location and what is stored; no outside service),
 * then the outfit once the wardrobe, the day's records and the bounded waits are in (DESIGN.md "היום" item 1).
 */
export default function Index() {
  const wardrobe = useWardrobe();
  const day = useDayContext();
  const userId = sessionUserId(useSession());
  // The saved outfits (the bookmark, which row a wear points at, and what the engine learns from, DESIGN.md "שלב 5.2"
  // item 8). Read here, alongside the wardrobe and the day, so the first suggestion rarely has to wait for it; and again
  // whenever Today is focused, as the collection does, so an outfit removed elsewhere is not still "saved" here.
  useFocusEffect(
    useCallback(() => {
      if (userId) void refreshOutfits(userId);
    }, [userId])
  );
  if (wardrobe.status === "error") return <WardrobeGate state={wardrobe} />;
  // The day needs only the device (location, stored answers) and the session is local: this line is a moment at most.
  if (!day || !userId) return <WardrobeGate state={{ status: "loading" }} />;
  return (
    <Today
      // A new day is a new screen: its opening tab and the session's nudges belong to the day they were made on.
      key={day.date}
      userId={userId}
      wardrobe={wardrobe}
      day={day}
    />
  );
}

/** Starts a timer for what is left of `bound` after `startedAt` while `active`; true once it has run out. */
function useBound(active: boolean, startedAt: number, bound: number): boolean {
  const [over, setOver] = useState(false);
  useEffect(() => {
    if (!active) return;
    const timer = setTimeout(() => setOver(true), Math.max(0, startedAt + bound - Date.now()));
    return () => clearTimeout(timer);
  }, [active, startedAt, bound]);
  return over;
}

function Today(props: { userId: string; wardrobe: Exclude<WardrobeState, { status: "error" }>; day: DayContext }) {
  const { userId, wardrobe, day } = props;
  const { t } = useTranslation();
  const ready = wardrobe.status === "ready";
  const items = ready ? wardrobe.items : NO_ITEMS;
  const pairWeights = ready ? wardrobe.pairWeights : NO_WEIGHTS;
  const patch: (fn: (data: WardrobeData) => WardrobeData) => void = ready ? wardrobe.patch : noPatch;
  // don't touch / the records are read up to the longest chain of planned days whatever today's chain is: the chain can
  // arrive after the screen opened (the calendar was late), and a new range would read the history again and take the
  // outfit off the screen while it loads.
  const until = addDays(day.date, CHAIN_MAX_DAYS).iso;
  const bookmark = useBookmark(userId);
  const { settled } = bookmark;
  // Which outfit row an answer is recorded on is decided here, at write time, from a settled saved list (a save still
  // on its way finishes first; a list still loading is waited for; a failed one is read once more; if it still cannot
  // be read the write fails instead of recording a copy of a saved outfit). See resolveWearRow.
  const resolveRow = useCallback(
    async (itemIds: string[]) => {
      await settled();
      return resolveWearRow(itemIds, {
        read: () => listNow(userId),
        settled: (ms) => whenSettled(userId, ms),
        reread: () => refreshOutfits(userId),
      });
    },
    [userId, settled]
  );
  // A worn record stored or deleted changes the count of its garment set in the shared store at once (and refreshes it);
  // the next focus read stays the truth.
  const onWornChange = useCallback(
    (record: { outfitId: string; itemIds: string[]; date: string }, delta: 1 | -1) => recordWornChange(userId, record, delta),
    [userId]
  );
  const feedback = useFeedback({ userId, date: day.date, dayType: day.dayType, until, items, pairWeights, patch, resolveRow, onWornChange });
  // What is on each date on screen (DESIGN.md "שלב 4.5"): today and the planned days.
  const dates = useMemo(() => [day.date, ...day.chain.map((d) => d.date)], [day]);
  const occasions = useOccasions(userId, dates);
  // The clock when the screen opened, in the location's zone: it picks the opening tab (three hours before candles).
  const [clock] = useState(() => localTime(day.tz));
  // The saved list Index reads (see there).
  const saved = useSavedOutfits(userId);
  // The first suggestion waits for the saved list, at most SAVED_LIST_GRACE_MS after everything else is in
  // (firstGeneration). The only moment of that wait that changes the answer is its end, so a timer started when the
  // rest is in marks it; no clock is read during render.
  const othersReady = ready && feedback.history !== null;
  const [graceOver, setGraceOver] = useState(false);
  useEffect(() => {
    if (!othersReady) return;
    const timer = setTimeout(() => setGraceOver(true), SAVED_LIST_GRACE_MS);
    return () => clearTimeout(timer);
  }, [othersReady]);
  // For the forecast and the calendar, at most WEATHER_GRACE_MS and CALENDAR_GRACE_MS after their requests started
  // (not after the rest is in: they run in parallel, from the same moment). The timer is set for what is left of that
  // bound when Today mounts; one that has already settled needs none.
  const forecast = day.forecast;
  const weatherGraceOver = useBound(forecast.pending, forecast.startedAt, WEATHER_GRACE_MS);
  const calendar = day.calendar;
  const calendarGraceOver = useBound(calendar.pending && !calendar.known, calendar.startedAt, CALENDAR_GRACE_MS);
  const calendarSettled = calendar.known || !calendar.pending || calendarGraceOver;
  const weatherSettled = !forecast.pending || weatherGraceOver;
  // don't touch / latched: once the first generation has happened, a list that is loading again (a focus read after a
  // failure) must not take the outfit off the screen, and a forecast or a calendar that arrives later must not either
  // (TodayView keeps the conditions the outfit was planned with until the user asks for another outfit).
  const [started, setStarted] = useState(false);
  const gate = started
    ? "started"
    : firstSuggestion({
        othersReady,
        saved: saved.status,
        savedWaitedMs: graceOver ? SAVED_LIST_GRACE_MS : 0,
        forecast: forecast.pending ? "loading" : forecast.source.kind === "fresh" ? "fresh" : "failed",
        cached: forecast.source.kind === "cached",
        forecastWaitedMs: weatherGraceOver ? WEATHER_GRACE_MS : 0,
        observes: day.observes,
        calendar: calendar.known ? "known" : calendar.pending ? "loading" : "failed",
        calendarWaitedMs: calendarGraceOver ? CALENDAR_GRACE_MS : 0,
      });
  if (gate !== "wait" && !started) setStarted(true);
  // The tab Today opens on (dayInForce), decided once: when the day's records are read and the planned days are known,
  // or are no longer waited for (the civil calendar's then), or at the first suggestion at the latest. Until then no
  // tabs are drawn. Planned days that arrive after it add tabs and move nothing (DESIGN.md "היום" item 1).
  const [openingTab, setOpeningTab] = useState<string | null>(null);
  if (openingTab === null && feedback.history && (calendarSettled || !day.observes || gate !== "wait")) {
    setOpeningTab(dayInForce({ day, now: clock, history: feedback.history }));
  }
  // A tab chosen by hand, in the frame or on the screen with its outfit, lasts while the screen is mounted.
  const [chosenTab, setChosenTab] = useState<string | null>(null);

  // The frame until the first suggestion: the device's data now, every other line in its place as it fills.
  if (!feedback.history || gate === "wait" || openingTab === null) {
    const dates = [day.date, ...day.chain.map((d) => d.date)];
    const selected = [chosenTab, openingTab].find((d): d is string => d !== null && dates.includes(d)) ?? day.date;
    return (
      <TodayFrame
        day={day}
        tabs={openingTab !== null ? { value: selected, onChange: setChosenTab } : null}
        waiting={t("common.loading")}
        weatherSettled={weatherSettled}
        calendarSettled={calendarSettled}
      />
    );
  }
  return (
    <TodayView
      items={items}
      pairWeights={pairWeights}
      day={day}
      history={feedback.history}
      actions={feedback.actions}
      busy={feedback.busy}
      failedOn={feedback.failedOn}
      laundered={feedback.laundered}
      correction={feedback.correction}
      stylist={requestStyle}
      occasions={occasions}
      bookmark={bookmark}
      savedOutfits={saved.status === "ready" ? saved.outfits : null}
      clock={clock}
      openingTab={openingTab}
      chosenTab={chosenTab}
      onChooseTab={setChosenTab}
    />
  );
}
