import type { Availability } from "@fit-check/schema";
import { WardrobeGate } from "../components/WardrobeGate";
import { setAvailabilityMany } from "../data/feedback";
import { useWardrobe } from "../data/WardrobeProvider";
import { WardrobeView } from "../features/wardrobe/WardrobeView";

/** Wardrobe: loads the items, then hands them to the view. Filters are local state inside the view. */
export default function Wardrobe() {
  const wardrobe = useWardrobe();
  if (wardrobe.status !== "ready") return <WardrobeGate state={wardrobe} />;
  const { patch, items } = wardrobe;

  /** Optimistic bulk move; on failure every item goes back to where it was and the error reaches the view. */
  const move = async (ids: string[], next: Availability) => {
    const before = new Map(items.filter((i) => ids.includes(i.id)).map((i) => [i.id, i.availability]));
    patch((d) => ({ ...d, items: d.items.map((i) => (before.has(i.id) ? { ...i, availability: next } : i)) }));
    try {
      // The only bulk move home is "back from base, all clean", so it resets the wear counts.
      await setAvailabilityMany(ids, next, { washed: next === "home" });
    } catch (error) {
      patch((d) => ({ ...d, items: d.items.map((i) => ({ ...i, availability: before.get(i.id) ?? i.availability })) }));
      throw error;
    }
  };
  return <WardrobeView all={items} onMove={move} />;
}
