import { WardrobeGate } from "../components/WardrobeGate";
import { useDayContext } from "../data/useDayContext";
import { useWardrobe } from "../data/WardrobeProvider";
import { TodayView } from "../features/today/TodayView";

/** Today: loads the wardrobe and the day, then hands both to the view. */
export default function Index() {
  const wardrobe = useWardrobe();
  const day = useDayContext();
  if (wardrobe.status !== "ready") return <WardrobeGate state={wardrobe} />;
  // The day loads in parallel with the wardrobe and never fails; until it lands, the same quiet loading line.
  if (!day) return <WardrobeGate state={{ status: "loading" }} />;
  return <TodayView items={wardrobe.items} pairWeights={wardrobe.pairWeights} day={day} />;
}
