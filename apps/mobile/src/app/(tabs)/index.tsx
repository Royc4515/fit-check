import type { PairWeights } from "@fit-check/engine";
import type { Item } from "@fit-check/schema";
import { useMemo, useState } from "react";
import { WardrobeGate } from "../../components/WardrobeGate";
import { localTime, type DayContext } from "../../data/dayContext";
import { useDayContext } from "../../data/useDayContext";
import { useFeedback } from "../../data/useFeedback";
import { useOccasions } from "../../data/occasions";
import { requestStyle } from "../../data/stylist";
import type { WardrobeData } from "../../data/wardrobe";
import { useWardrobe } from "../../data/WardrobeProvider";
import { sessionUserId, useSession } from "../../features/auth/SessionProvider";
import { TodayView } from "../../features/today/TodayView";

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
  const feedback = useFeedback({ userId, date: day.date, dayType: day.dayType, until, items, pairWeights, patch });
  // What is on each date on screen (DESIGN.md "שלב 4.5"): today and the planned days.
  const dates = useMemo(() => [day.date, ...day.chain.map((d) => d.date)], [day]);
  const occasions = useOccasions(userId, dates);
  // The clock when the screen opened, in the location's zone: it picks the opening tab (three hours before candles).
  const [clock] = useState(() => localTime(day.tz));
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
      clock={clock}
    />
  );
}
