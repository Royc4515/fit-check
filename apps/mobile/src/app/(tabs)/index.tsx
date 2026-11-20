import type { PairWeights } from "@fit-check/engine";
import type { Item } from "@fit-check/schema";
import { useFocusEffect } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { WardrobeGate } from "../../components/WardrobeGate";
import { localTime, type DayContext } from "../../data/dayContext";
import { useDayContext } from "../../data/useDayContext";
import { useFeedback } from "../../data/useFeedback";
import { useOccasions } from "../../data/occasions";
import { requestStyle } from "../../data/stylist";
import type { WardrobeData } from "../../data/wardrobe";
import { useWardrobe } from "../../data/WardrobeProvider";
import { sessionUserId, useSession } from "../../features/auth/SessionProvider";
import { withWornChange } from "../../features/outfits/collection";
import { listNow, patchOutfits, refreshOutfits, useSavedOutfits, whenSettled } from "../../features/outfits/store";
import { resolveWearRow } from "../../features/today/bookmark";
import { TodayView } from "../../features/today/TodayView";
import { useBookmark } from "../../features/today/useBookmark";

/** Today: loads the wardrobe and the day, then hands both to the view. */
export default function Index() {
  const wardrobe = useWardrobe();
  const day = useDayContext();
  const userId = sessionUserId(useSession());
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
  // A worn record stored on, or deleted from, a saved outfit changes its count and date in the shared store at once;
  // the next focus read stays the truth.
  const onWornChange = useCallback(
    (record: { outfitId: string; date: string }, delta: 1 | -1) => patchOutfits(userId, (list) => withWornChange(list, record.outfitId, delta, record.date)),
    [userId]
  );
  const feedback = useFeedback({ userId, date: day.date, dayType: day.dayType, until, items, pairWeights, patch, resolveRow, onWornChange });
  // What is on each date on screen (DESIGN.md "שלב 4.5"): today and the planned days.
  const dates = useMemo(() => [day.date, ...day.chain.map((d) => d.date)], [day]);
  const occasions = useOccasions(userId, dates);
  // The clock when the screen opened, in the location's zone: it picks the opening tab (three hours before candles).
  const [clock] = useState(() => localTime(day.tz));
  // The saved outfits (the bookmark, and which row a wear points at). One read, started only once the day's outfit
  // has what it needs to be drawn, so it never delays the first paint; and again whenever Today is focused, as the
  // collection does, so an outfit removed elsewhere is not still "saved" here.
  const outfitReady = feedback.history !== null;
  // The same list, for the engine to learn from (DESIGN.md "שלב 5.2" item 8). Null until read: Today never waits for
  // it, and TodayView takes it in only at the next regeneration (features/today/learning.ts).
  const saved = useSavedOutfits(userId);
  useFocusEffect(
    useCallback(() => {
      if (outfitReady) void refreshOutfits(userId);
    }, [userId, outfitReady])
  );
  // Wait for today's answers so an outfit already marked worn never flashes as a fresh suggestion.
  if (!feedback.history) return <WardrobeGate state={{ status: "loading" }} />;
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
