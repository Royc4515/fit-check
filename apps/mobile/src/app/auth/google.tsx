import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Monogram } from "../../components/brand/Monogram";
import { Button, ScreenColumn, StatusLine } from "../../components/ui";
import { finishDirectSignIn, type FinishFailure } from "../../features/auth/googleDirect";
import { signInClassic } from "../../features/auth/signIn";
import { supabase } from "../../lib/supabase";

type State = { kind: "working" } | { kind: "failed"; reason: Exclude<FinishFailure, "cancelled"> };

/**
 * Drops the fragment (the ID token) from the address bar and the history entry.
 * don't touch / called twice: once at once, and again after the router's first sync, which writes back the URL it
 * parsed on load (the same trap as `?preview=` in app/_layout.tsx); a single early call left the token in the bar.
 */
const clearFragment = () => {
  if (typeof window !== "undefined" && window.location.hash) window.history.replaceState(window.history.state, "", window.location.pathname);
};

/**
 * The one finish of this page load, shared by every mount of the screen.
 * don't touch / signing in remounts the whole stack (the root layout wraps it in the signed-in user's
 * WardrobeProvider), so this screen mounts twice; a second finish found the pending sign-in already used and showed
 * "didn't finish" over a sign-in that had worked. Module scope survives the remount.
 */
let outcome: ReturnType<typeof finishDirectSignIn> | null = null;
const finishOnce = () => {
  if (outcome === null) {
    const hash = typeof window === "undefined" ? "" : window.location.hash;
    clearFragment();
    outcome = finishDirectSignIn(hash, (args) => supabase.auth.signInWithIdToken(args));
  }
  return outcome;
};

/**
 * /auth/google: where Google sends the user back with an ID token (features/auth/googleDirect.ts). It hands the token
 * to Supabase and goes home; the root layout then resumes a Claude connection that was waiting for this sign-in.
 * Outside both route guards, since the visitor is not signed in yet when it opens.
 * Failure modes: a closed chooser goes back to sign-in quietly; anything else (a foreign or stale state, a token
 * Supabase rejects) says so and offers the classic sign-in, which does not depend on this page.
 */
export default function GoogleCallback() {
  const { t } = useTranslation();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [state, setState] = useState<State>({ kind: "working" });

  useEffect(() => {
    let active = true;
    const again = setTimeout(clearFragment, 50);
    void finishOnce().then((result) => {
      clearFragment();
      if (!active) return;
      if (result.ok || result.reason === "cancelled") {
        // A tick later, so a waiting Claude connection (root layout, oauthPending.ts) can take the route first; if it
        // did, this screen has unmounted and stays out of the way.
        setTimeout(() => active && router.replace(result.ok ? "/" : "/sign-in"), 0);
        return;
      }
      setState({ kind: "failed", reason: result.reason });
    });
    return () => {
      active = false;
      clearTimeout(again);
    };
  }, [router]);

  return (
    <ScrollView className="flex-1 bg-ivory" contentContainerStyle={{ flexGrow: 1 }}>
      <ScreenColumn>
        <View style={{ paddingTop: insets.top + 32, paddingBottom: insets.bottom + 48, gap: 24 }}>
          <Monogram />
          {state.kind === "working" ? (
            <Text className="font-body text-body text-ink-soft" accessibilityLiveRegion="polite">
              {t("auth.direct.working")}
            </Text>
          ) : (
            <View style={{ gap: 12 }}>
              <StatusLine variant="error" message={t("auth.direct.failed")} />
              <Button variant="primary" fullWidth label={t("auth.direct.classic")} onPress={() => void signInClassic()} />
              <View className="items-start">
                <Button variant="text" label={t("auth.direct.back")} onPress={() => router.replace("/sign-in")} />
              </View>
            </View>
          )}
        </View>
      </ScreenColumn>
    </ScrollView>
  );
}
