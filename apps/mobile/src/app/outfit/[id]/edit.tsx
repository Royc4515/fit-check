import { useLocalSearchParams } from "expo-router";
import { sessionUserId, useSession } from "../../../features/auth/SessionProvider";
import { BuilderView } from "../../../features/outfits/BuilderView";

/**
 * Editing a saved outfit (DESIGN.md "שלב 5.2" items 4-5): the build screen filled with that outfit, opened from the
 * outfit screen's "more". Lives beside `outfit/[id].tsx` (Expo Router takes a route file and a folder of the same
 * name as two routes), at `/outfit/<id>/edit`.
 */
export default function EditOutfitScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const userId = sessionUserId(useSession());
  return userId && id ? <BuilderView userId={userId} editId={id} /> : null;
}
