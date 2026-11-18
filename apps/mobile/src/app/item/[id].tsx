import type { Availability, Item } from "@fit-check/schema";
import { useLocalSearchParams } from "expo-router";
import { WardrobeGate } from "../../components/WardrobeGate";
import { setAvailability } from "../../data/feedback";
import { archiveItem, setItemImage, updateItemDetails } from "../../data/items";
import { useWardrobe } from "../../data/WardrobeProvider";
import { sessionUserId, useSession } from "../../features/auth/SessionProvider";
import type { ItemEdits } from "../../features/item/edit";
import { ItemView } from "../../features/item/ItemView";

/**
 * Item route: wires the wardrobe store and the data layer into the item screen (features/item/ItemView). Tag and
 * name edits are optimistic: the store changes at once, the write follows, and a failed write puts the item back
 * (the screen says so). Image changes and removal write first: they are deliberate actions with their own progress.
 */
export default function ItemScreen() {
  const wardrobe = useWardrobe();
  const userId = sessionUserId(useSession());
  const { id } = useLocalSearchParams<{ id: string }>();
  if (wardrobe.status !== "ready") return <WardrobeGate state={wardrobe} />;
  const { patch } = wardrobe;
  const update = (itemId: string, fn: (i: Item) => Item) =>
    patch((d) => ({ ...d, items: d.items.map((i) => (i.id === itemId ? fn(i) : i)) }));
  const edits: ItemEdits | undefined = userId
    ? {
        userId,
        save: async (itemId, e) => {
          const before = wardrobe.items.find((i) => i.id === itemId);
          if (!before) return;
          const optimistic = { name: e.name, brand: e.brand, tags: e.tags };
          update(itemId, (i) => ({ ...i, ...optimistic }));
          try {
            await updateItemDetails(itemId, e);
          } catch (error) {
            // Roll back only if nothing newer replaced this edit meanwhile; a later edit owns the item now.
            update(itemId, (i) =>
              i.name === optimistic.name && i.brand === optimistic.brand && i.tags === optimistic.tags
                ? { ...i, name: before.name, brand: before.brand, tags: before.tags }
                : i
            );
            throw error;
          }
        },
        setImage: async (itemId, cutoutPath, thumbPath) => {
          await setItemImage(itemId, cutoutPath, thumbPath);
          update(itemId, (i) => ({ ...i, cutout_path: cutoutPath }));
        },
        archive: async (itemId) => {
          await archiveItem(itemId);
          update(itemId, (i) => ({ ...i, status: "archived" }));
        },
      }
    : undefined;
  /** Optimistic: the control moves at once; a failed write moves it back and rethrows so the screen can say so. */
  const changeAvailability = async (itemId: string, next: Availability, prev: Availability) => {
    const set = (a: Availability) => update(itemId, (i) => ({ ...i, availability: a }));
    set(next);
    try {
      // Back home from the laundry or from base means it was washed: its wear count starts over.
      await setAvailability(itemId, next, { washed: next === "home" && (prev === "laundry" || prev === "away") });
    } catch (error) {
      set(prev);
      throw error;
    }
  };
  return <ItemView id={id} items={wardrobe.items} pairWeights={wardrobe.pairWeights} onAvailability={changeAvailability} edits={edits} />;
}
