import { useEffect } from "react";
import { View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { colors } from "../../theme/tokens";
import { useSession } from "../../features/auth/SessionProvider";
import { claimPendingReferral, rememberReferral } from "../../features/referral/pendingReferral";
import { claimReferral } from "../../data/referral";

/**
 * /join/<code>: the link a user shares to bring a friend in (Roy, 2026-11-25). It keeps the code and moves on at
 * once: to sign-in for a visitor, home for someone already signed in. The claim itself runs after sign-in, in the
 * root layout, so it never depends on this screen staying mounted. Outside both route guards, like /privacy.
 * Nothing to read here, so it renders the ivory page only and no text.
 */
export default function Join() {
  const { code } = useLocalSearchParams<{ code?: string }>();
  const session = useSession();
  const router = useRouter();
  const ready = session.status !== "loading";
  const signedIn = session.status === "signedIn";

  useEffect(() => {
    if (!ready) return;
    let active = true;
    void rememberReferral(typeof code === "string" ? code : "")
      // Already signed in: the root layout's claim ran at sign-in, before this code existed, so claim it here.
      .then(() => (signedIn ? claimPendingReferral(claimReferral) : undefined))
      .then(() => {
        if (active) router.replace(signedIn ? "/" : "/sign-in");
      });
    return () => {
      active = false;
    };
  }, [code, ready, signedIn, router]);

  return <View style={{ flex: 1, backgroundColor: colors["ivory"] }} />;
}
