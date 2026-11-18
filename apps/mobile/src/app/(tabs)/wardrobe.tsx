import type { Availability } from "@fit-check/schema";
import { WardrobeGate } from "../../components/WardrobeGate";
import { setAvailability, setAvailabilityMany } from "../../data/feedback";
import { archiveItem } from "../../data/items";
import { useWardrobe } from "../../data/WardrobeProvider";
import { WardrobeView } from "../../features/wardrobe/WardrobeView";

/**
 * Wardrobe: loads the items, then hands them to the view with the three writes it can make. Filters are local
 * state inside the view. The writes are the same data functions the item screen uses, with the same rules.
 */
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

  /** Optimistic, as on the item screen: the control moves at once; a failed write moves it back and rethrows. */
  const changeAvailability = async (itemId: string, next: Availability, prev: Availability) => {
    const set = (a: Availability) => patch((d) => ({ ...d, items: d.items.map((i) => (i.id === itemId ? { ...i, availability: a } : i)) }));
    set(next);
    try {
      // Back home from the laundry or from base means it was washed: its wear count starts over.
      await setAvailability(itemId, next, { washed: next === "home" && (prev === "laundry" || prev === "away") });
    } catch (error) {
      set(prev);
      throw error;
    }
  };

  /** Write first, then the local copy (as on the item screen): a tile must not vanish for a removal that did not save. */
  const archive = async (itemId: string) => {
    await archiveItem(itemId);
    patch((d) => ({ ...d, items: d.items.map((i) => (i.id === itemId ? { ...i, status: "archived" } : i)) }));
  };

  return <WardrobeView all={items} onMove={move} onAvailability={changeAvailability} onArchive={archive} />;
}
