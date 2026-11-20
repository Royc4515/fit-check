import { useLocalSearchParams } from "expo-router";
import { sessionUserId, useSession } from "../../features/auth/SessionProvider";
import { OutfitView } from "../../features/outfits/OutfitView";

/**
 * A saved outfit (DESIGN.md "שלב 5.2" item 4), over everything like the item screen. Reads through the outfits store,
 * so a favourite, a rename or a removal here is already true in the collection underneath.
 */
export default function OutfitScreen() {
  const { id, notice } = useLocalSearchParams<{ id: string; notice?: string }>();
  const userId = sessionUserId(useSession());
  return userId ? <OutfitView id={id} userId={userId} notice={notice === "already" ? "already" : undefined} /> : null;
}
