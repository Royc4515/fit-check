import { sessionUserId, useSession } from "../../features/auth/SessionProvider";
import { BuilderView } from "../../features/outfits/BuilderView";

/**
 * Building an outfit by hand (DESIGN.md "שלב 5.2" item 5), opened from the "+" choice and the collection's empty
 * state. Over everything like the outfit screen. A static segment, so it wins over `outfit/[id]`.
 */
export default function NewOutfitScreen() {
  const userId = sessionUserId(useSession());
  return userId ? <BuilderView userId={userId} /> : null;
}
