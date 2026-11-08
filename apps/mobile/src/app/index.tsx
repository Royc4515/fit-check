import type { PairWeights } from "@fit-check/engine";
import type { Item } from "@fit-check/schema";
import { WardrobeGate } from "../components/WardrobeGate";
import type { DayContext } from "../data/dayContext";
import { useDayContext } from "../data/useDayContext";
import { useFeedback } from "../data/useFeedback";
import type { WardrobeData } from "../data/wardrobe";
import { useWardrobe } from "../data/WardrobeProvider";
import { useSession } from "../features/auth/SessionProvider";
import { TodayView } from "../features/today/TodayView";

/** Today: loads the wardrobe and the day, then hands both to the view. */
export default function Index() {
  const wardrobe = useWardrobe();
  const day = useDayContext();
  const session = useSession();
  if (wardrobe.status !== "ready") return <WardrobeGate state={wardrobe} />;
  // The day loads in parallel with the wardrobe and never fails; until it lands, the same quiet loading line.
  if (!day || session.status !== "signedIn") return <WardrobeGate state={{ status: "loading" }} />;
  return (
    <Today
      userId={session.session.user.id}
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
  const feedback = useFeedback({ userId, date: day.date, dayType: day.dayType, pairWeights, patch });
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
      failed={feedback.failed}
    />
  );
}
