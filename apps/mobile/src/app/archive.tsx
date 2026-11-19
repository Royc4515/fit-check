import { useRouter } from "expo-router";
import { WardrobeGate } from "../components/WardrobeGate";
import { useArchivedItems, useSetItemStatus, useWardrobe } from "../data/WardrobeProvider";
import { ArchiveView } from "../features/archive/ArchiveView";

/**
 * The archive: items removed from the wardrobe, each restorable. Above the tabs, like Location; reached from the
 * profile's "ארכיון" row. Reads the shared wardrobe load (archived rows come with it), so no fetch of its own.
 */
export default function ArchiveScreen() {
  const router = useRouter();
  const wardrobe = useWardrobe();
  const archived = useArchivedItems();
  const setStatus = useSetItemStatus();
  if (wardrobe.status !== "ready" || archived === null) return wardrobe.status === "ready" ? null : <WardrobeGate state={wardrobe} />;
  // A deep link to /archive has no history, so back would do nothing; Profile is where the archive row lives.
  const back = () => (router.canGoBack() ? router.back() : router.replace("/profile"));
  return <ArchiveView items={archived} onBack={back} onRestore={(id) => setStatus(id, "active")} />;
}
