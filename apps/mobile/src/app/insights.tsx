import { useRouter } from "expo-router";
import { InsightsView } from "../features/insights/InsightsView";

/**
 * Insights: a screen above the tabs since stage 5.2 (DESIGN.md "שלב 5.2" item 1), reached from the first row of the
 * profile. The URL is still /insights, as it was when Insights was a tab (route groups add nothing to a URL), so old
 * links and bookmarks land here.
 */
export default function Insights() {
  const router = useRouter();
  // A deep link to /insights has no history, so back would do nothing; Profile is where the Insights row lives.
  const back = () => (router.canGoBack() ? router.back() : router.replace("/profile"));
  return <InsightsView onBack={back} />;
}
