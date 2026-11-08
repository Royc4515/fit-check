import { WardrobeGate } from "../components/WardrobeGate";
import { useSession } from "../features/auth/SessionProvider";
import { IntakeView } from "../features/intake/IntakeView";

/** Add clothes from photos. Needs only the signed-in user; the wardrobe itself is not read here yet. */
export default function Intake() {
  const session = useSession();
  if (session.status !== "signedIn") return <WardrobeGate state={{ status: "loading" }} />;
  return <IntakeView userId={session.session.user.id} />;
}
