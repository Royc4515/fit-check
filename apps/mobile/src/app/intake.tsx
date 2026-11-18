import { WardrobeGate } from "../components/WardrobeGate";
import { sessionUserId, useSession } from "../features/auth/SessionProvider";
import { IntakeView } from "../features/intake/IntakeView";

/** Add clothes from photos. Needs only the signed-in user; the wardrobe itself is not read here yet. */
export default function Intake() {
  const userId = sessionUserId(useSession());
  if (!userId) return <WardrobeGate state={{ status: "loading" }} />;
  return <IntakeView userId={userId} />;
}
