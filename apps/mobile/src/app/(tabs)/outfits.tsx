import { sessionUserId, useSession } from "../../features/auth/SessionProvider";
import { OutfitsView } from "../../features/outfits/OutfitsView";

/** Outfits tab (DESIGN.md "שלב 5.2" item 3): the saved outfits. The route guard keeps signed-out users out. */
export default function Outfits() {
  const userId = sessionUserId(useSession());
  return userId ? <OutfitsView userId={userId} /> : null;
}
