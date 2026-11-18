import "../../global.css";
// don't touch / first import on purpose: it initialises i18n and sets the document direction before any other module
// (providers, screens) reads a translation or `isRtl()` at load time. `isRtl` rides on the same import.
import { isRtl } from "../i18n";
import { Stack, useRouter, useSegments } from "expo-router";
import { useEffect, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import { StatusBar } from "expo-status-bar";
import { View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { colors } from "../theme/tokens";
import { useAppFonts } from "../theme/fonts";
import { WardrobeProvider } from "../data/WardrobeProvider";
import { isPreview } from "../data/preview";
import { PreviewBanner } from "../components/PreviewBanner";
import { takePendingConsent } from "../features/auth/oauthPending";
import { SessionProvider, sessionUserId, useSession } from "../features/auth/SessionProvider";

// ViewProps has no `dir` in RN's types, but react-native-web reads it. Spreading a typed object keeps this
// free of casts; the excess-property check does not apply to JSX spreads. Computed per render (not once at load) so
// Profile's language switch flips the whole web layout at once, without a reload.
const directionProps = (rtl: boolean) => ({ dir: rtl ? "rtl" : "ltr" });

/** Nothing changes the mounted flag after hydration, so there is nothing to subscribe to. */
const subscribeNever = () => () => {};

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
  // don't touch / the design-preview code must leave the address bar (screenshots, copied links). preview.ts strips it
  // from history, but the router parsed the URL before that and wrote `?preview=` back on its next sync.
  const previewMode = session.status === "preview";
  useEffect(() => {
    if (previewMode) router.setParams({ preview: undefined });
  }, [previewMode, router]);
  // First storage read: render nothing rather than flash the sign-in screen at a signed-in user.
  if (session.status === "loading") return quiet;
  // The design preview counts as signed in for the guards; its data layer is read-only (data/preview.ts).
  const userId = sessionUserId(session);
  const signedIn = userId !== null;

  const stack = (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: colors["ivory"] },
      }}
    >
      <Stack.Protected guard={signedIn}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="location" />
        <Stack.Screen name="archive" />
        {/* Internal component gallery; not linked from any screen. */}
        <Stack.Screen name="design-system" />
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
  return userId !== null ? (
    <WardrobeProvider key={userId} userId={userId}>
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
  // Derived, not set in an effect: the server snapshot is false and the client snapshot true, which is exactly
  // "false while pre-rendering and hydrating, true once on the client", with no state update inside an effect.
  const mounted = useSyncExternalStore(subscribeNever, () => true, () => false);
  // The tabs (and the item screen above them) carry the preview banner themselves, stacked above the tab bar. Here
  // only the screens outside them need it. Moving it in and out of this flow would resize the stack mid item flight.
  const first = useSegments()[0];
  const tabsOwnBanner = first === "(tabs)" || first === "item";
  // Re-renders this layout on a language change, so `dir` below follows it.
  const { i18n } = useTranslation();
  const rtl = isRtl(i18n.language === "en" ? "en" : "he");
  // Quiet empty state while fonts load: no spinner, no skeleton (DESIGN.md section 1).
  if (!fontsLoaded || !mounted) return quiet;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      {/* don't touch / `dir` is what makes react-native-web resolve start/end/marginStart for RTL. Setting
          document.dir alone (see i18n/index.ts) flips the flex rows but leaves logical props on the LTR side,
          which shifted the outfit composition 8px out of its gutter in Hebrew. Harmless on native. */}
      <View {...directionProps(rtl)} style={{ flex: 1 }}>
        <StatusBar style="dark" />
        <View style={{ flex: 1 }}>
          <SessionProvider>
            <Routes />
          </SessionProvider>
        </View>
        {isPreview() && !tabsOwnBanner ? <PreviewBanner /> : null}
      </View>
    </GestureHandlerRootView>
  );
}
