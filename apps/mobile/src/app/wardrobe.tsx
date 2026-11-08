import { WardrobeGate } from "../components/WardrobeGate";
import { useWardrobe } from "../data/WardrobeProvider";
import { WardrobeView } from "../features/wardrobe/WardrobeView";

/** Wardrobe: loads the items, then hands them to the view. Filters are local state inside the view. */
export default function Wardrobe() {
  const wardrobe = useWardrobe();
  if (wardrobe.status !== "ready") return <WardrobeGate state={wardrobe} />;
  return <WardrobeView all={wardrobe.items} />;
}
