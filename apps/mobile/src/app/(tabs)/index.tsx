import type { PairWeights } from "@fit-check/engine";
import type { Item } from "@fit-check/schema";
import { useFocusEffect } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { WardrobeGate } from "../../components/WardrobeGate";
import { localTime, type DayContext } from "../../data/dayContext";
import { useDayContext } from "../../data/useDayContext";
import { useFeedback } from "../../data/useFeedback";
import { useOccasions } from "../../data/occasions";
import { requestStyle } from "../../data/stylist";
import type { WardrobeData } from "../../data/wardrobe";
import { useWardrobe } from "../../data/WardrobeProvider";
import { sessionUserId, useSession } from "../../features/auth/SessionProvider";
import { listNow, recordWornChange, refreshOutfits, useSavedOutfits, whenSettled } from "../../features/outfits/store";
import { resolveWearRow } from "../../features/today/bookmark";
import { firstSuggestion, SAVED_LIST_GRACE_MS, WEATHER_GRACE_MS } from "../../features/today/learning";
import { TodayView } from "../../features/today/TodayView";
import { useBookmark } from "../../features/today/useBookmark";

/** Today: loads the wardrobe and the day, then hands both to the view. */
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
  if (wardrobe.status !== "ready") return <WardrobeGate state={wardrobe} />;
  // The day loads in parallel with the wardrobe and never fails; until it lands, the same quiet loading line.
  if (!day || !userId) return <WardrobeGate state={{ status: "loading" }} />;
  return (
    <Today
      // A new day is a new screen: its opening tab and the session's nudges belong to the day they were made on.
      key={day.date}
      userId={userId}
      items={wardrobe.items}
      pairWeights={wardrobe.pairWeights}
      patch={wardrobe.patch}
      day={day}
    />
  );
}

function Today(props: {
  userId: string;
  items: Item[];
  pairWeights: PairWeights;
  patch: (fn: (data: WardrobeData) => WardrobeData) => void;
  day: DayContext;
}) {
  const { userId, items, pairWeights, patch, day } = props;
  // On the eve of Shabbat or a holiday the history reaches the last planned day, so what was recorded ahead shows.
  const until = day.chain.at(-1)?.date ?? day.date;
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
  const othersReady = feedback.history !== null;
  const [graceOver, setGraceOver] = useState(false);
  useEffect(() => {
    if (!othersReady) return;
    const timer = setTimeout(() => setGraceOver(true), SAVED_LIST_GRACE_MS);
    return () => clearTimeout(timer);
  }, [othersReady]);
  // And for the forecast, at most WEATHER_GRACE_MS after its request started (not after the rest is in: it runs in
  // parallel). The timer is set for what is left of that bound when Today mounts; a forecast that has already
  // settled needs none.
  const forecast = day.forecast;
  const [weatherGraceOver, setWeatherGraceOver] = useState(false);
  useEffect(() => {
    if (!forecast.pending) return;
    const timer = setTimeout(() => setWeatherGraceOver(true), Math.max(0, forecast.startedAt + WEATHER_GRACE_MS - Date.now()));
    return () => clearTimeout(timer);
  }, [forecast.pending, forecast.startedAt]);
  // don't touch / latched: once the first generation has happened, a list that is loading again (a focus read after a
  // failure) must not take the outfit off the screen, and a forecast that arrives later must not either (TodayView
  // keeps the forecast the outfit was planned with until the user asks for another outfit).
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
      });
  if (gate !== "wait" && !started) setStarted(true);
  // Wait for today's answers so an outfit already marked worn never flashes as a fresh suggestion, and briefly for the
  // saved list and the forecast (same loading line).
  if (!feedback.history || gate === "wait") return <WardrobeGate state={{ status: "loading" }} />;
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
    />
  );
}
