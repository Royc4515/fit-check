import "../../global.css";
import "../i18n";
import { Stack, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { StatusBar } from "expo-status-bar";
import { View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { colors } from "../theme/tokens";
import { useAppFonts } from "../theme/fonts";
import { WardrobeProvider } from "../data/WardrobeProvider";
import { takePendingConsent } from "../features/auth/oauthPending";
import { SessionProvider, useSession } from "../features/auth/SessionProvider";
import { isRtl } from "../i18n";

// ViewProps has no `dir` in RN's types, but react-native-web reads it. Spreading a typed object keeps this
// free of casts; the excess-property check does not apply to JSX spreads.
const directionProps = { dir: isRtl() ? "rtl" : "ltr" };

const quiet = <View style={{ flex: 1, backgroundColor: colors["ivory"] }} />;

/**
 * Route guards: signed-out users can only reach sign-in, signed-in users can reach everything else. Guards (not
 * redirects in each screen) so a deep link to /item/<id> while signed out lands on sign-in instead of a screen
 * that renders empty, and a signed-in user can never see sign-in.
 */
function Routes() {
  const session = useSession();
  const router = useRouter();
  const signedInNow = session.status === "signedIn";
  // A Claude connection that was waiting for Google sign-in resumes on its consent page (see oauthPending.ts).
  useEffect(() => {
    if (!signedInNow) return;
    const pending = takePendingConsent();
    if (pending) router.replace({ pathname: "/oauth/consent", params: { authorization_id: pending } });
  }, [signedInNow, router]);
  // First storage read: render nothing rather than flash the sign-in screen at a signed-in user.
  if (session.status === "loading") return quiet;
  const signedIn = session.status === "signedIn";

  const stack = (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: colors["ivory"] },
      }}
    >
      <Stack.Protected guard={signedIn}>
        <Stack.Screen name="index" />
        <Stack.Screen name="wardrobe" />
        <Stack.Screen name="location" />
        <Stack.Screen name="intake" />
        {/* don't touch / transparent + no native animation: the item screen runs its own shared-element
            flight and fades its page in over the wardrobe. A default push would slide over that flight. */}
        <Stack.Screen
          name="item/[id]"
          options={{
            presentation: "transparentModal",
            animation: "none",
            contentStyle: { backgroundColor: "transparent" },
          }}
        />
      </Stack.Protected>
      <Stack.Protected guard={!signedIn}>
        <Stack.Screen name="sign-in" />
      </Stack.Protected>
      {/* Outside both guards: Supabase's OAuth server sends signed-in and signed-out browsers here alike. */}
      <Stack.Screen name="oauth/consent" />
    </Stack>
  );

  // key = user id: a different user remounts the provider, so one user's wardrobe never shows for another.
  return session.status === "signedIn" ? (
    <WardrobeProvider key={session.session.user.id} userId={session.session.user.id}>
      {stack}
    </WardrobeProvider>
  ) : (
    stack
  );
}

export default function RootLayout() {
  const fontsLoaded = useAppFonts();
  // don't touch / render nothing until mounted. The web export is pre-rendered on a server whose locale is
  // not the user's, and React does not patch attributes (`dir`, inline styles) when hydrating, so SSR output
  // silently won in the wrong language/width. Locale and window size are client facts; skip server content.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  // Quiet empty state while fonts load: no spinner, no skeleton (DESIGN.md section 1).
  if (!fontsLoaded || !mounted) return quiet;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      {/* don't touch / `dir` is what makes react-native-web resolve start/end/marginStart for RTL. Setting
          document.dir alone (see i18n/index.ts) flips the flex rows but leaves logical props on the LTR side,
          which shifted the outfit composition 8px out of its gutter in Hebrew. Harmless on native. */}
      <View {...directionProps} style={{ flex: 1 }}>
        <StatusBar style="dark" />
        <SessionProvider>
          <Routes />
        </SessionProvider>
      </View>
    </GestureHandlerRootView>
  );
}
