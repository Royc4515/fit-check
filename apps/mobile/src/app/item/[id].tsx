import type { Availability, Item } from "@fit-check/schema";
import { useLocalSearchParams } from "expo-router";
import { WardrobeGate } from "../../components/WardrobeGate";
import { setAvailability } from "../../data/feedback";
import { archiveItem, setItemImage, updateItemDetails, updateItemNotes } from "../../data/items";
import { useLastRemoved, useWardrobe } from "../../data/WardrobeProvider";
import { sessionUserId, useSession } from "../../features/auth/SessionProvider";
import { editPayload, type ItemEdits } from "../../features/item/edit";
import type { ItemFields } from "../../features/item/editQueue";
import { ItemEditRunner, type ItemWriter } from "../../features/item/editRunner";
import { ItemView } from "../../features/item/ItemView";

const fieldsOf = (i: Item): ItemFields => ({ name: i.name, brand: i.brand, notes: i.notes, availability: i.availability, tags: i.tags });

/**
 * One server write for one queued edit: only the parts that differ from the confirmed state. Edits change one thing
 * at a time (a field, a tag patch, the notes, the availability), so this is one call in practice.
 */
const writeItem: ItemWriter = async (itemId, before, after) => {
  if (after.name !== before.name || after.brand !== before.brand || JSON.stringify(after.tags) !== JSON.stringify(before.tags)) {
    await updateItemDetails(itemId, { name: after.name, brand: after.brand, tags: after.tags });
  }
  if (after.notes !== before.notes) await updateItemNotes(itemId, after.notes);
  if (after.availability !== before.availability) {
    // Back home from the laundry or from base means it was washed: its wear count starts over. Judged against the
    // confirmed state, not a render's copy.
    const washed = after.availability === "home" && (before.availability === "laundry" || before.availability === "away");
    await setAvailability(itemId, after.availability, { washed });
  }
};

// don't touch / module scope, not component state: a write that settles after the screen unmounted (back pressed
// right after an edit) must still settle the wardrobe store, and edits from a remounted screen join the same queue.
const runner = new ItemEditRunner(writeItem);

/**
 * Item route: wires the wardrobe store and the data layer into the item screen (features/item/ItemView). Tag, name,
 * notes and availability edits are optimistic and serialised per item (editQueue.ts): the store shows them at once,
 * the writes go one at a time, and a failed write rolls back only its own fields. Image changes and removal write
 * first: they are deliberate actions with their own progress.
 */
export default function ItemScreen() {
  const wardrobe = useWardrobe();
  const [, setRemoved] = useLastRemoved();
  const userId = sessionUserId(useSession());
  const { id } = useLocalSearchParams<{ id: string }>();
  if (wardrobe.status !== "ready") return <WardrobeGate state={wardrobe} />;
  const { patch } = wardrobe;
  const update = (itemId: string, fn: (i: Item) => Item) =>
    patch((d) => ({ ...d, items: d.items.map((i) => (i.id === itemId ? fn(i) : i)) }));
  const publish = (itemId: string, f: ItemFields) => update(itemId, (i) => ({ ...i, ...f }));
  const stored = (itemId: string) => {
    const item = wardrobe.items.find((i) => i.id === itemId);
    return item ? fieldsOf(item) : null;
  };

  const edits: ItemEdits | undefined = userId
    ? {
        userId,
        save: async (itemId, change) => {
          const base = stored(itemId);
          if (!base) return;
          await runner.submit(itemId, base, (cur) => {
            const payload = editPayload(cur, change);
            return payload ? { ...cur, ...payload } : null;
          }, publish);
        },
        setImage: async (itemId, cutoutPath, thumbPath) => {
          await setItemImage(itemId, cutoutPath, thumbPath);
          update(itemId, (i) => ({ ...i, cutout_path: cutoutPath }));
        },
        archive: async (itemId) => {
          await archiveItem(itemId);
          const name = wardrobe.items.find((i) => i.id === itemId)?.name ?? "";
          update(itemId, (i) => ({ ...i, status: "archived" }));
          // The wardrobe offers it back when the user lands there, as after a removal from its own sheet.
          setRemoved({ id: itemId, name, failed: false });
        },
      }
    : undefined;
  /** Optimistic and serialised with the other edits of the item; rejects after the control moved back. */
  const changeAvailability = async (itemId: string, next: Availability) => {
    const base = stored(itemId);
    if (!base) return;
    await runner.submit(itemId, base, (cur) => (cur.availability === next ? null : { ...cur, availability: next }), publish);
  };
  return <ItemView id={id} items={wardrobe.items} pairWeights={wardrobe.pairWeights} onAvailability={changeAvailability} edits={edits} />;
}
