import i18next from "i18next";
import * as Linking from "expo-linking";
import * as WebBrowser from "expo-web-browser";
import { Platform } from "react-native";
import { supabase } from "../../lib/supabase";
import { directSignInAvailable, startDirectSignIn } from "./googleDirect";

// Lets the popup/redirect page on web hand its result back to the opener; a no-op on native.
WebBrowser.maybeCompleteAuthSession();

export type SignInResult = { ok: true } | { ok: false; reason: "cancelled" | "failed" };

const failed: SignInResult = { ok: false, reason: "failed" };

/**
 * Google sign-in through Supabase Auth.
 *
 * Web: on the origins Google knows (googleDirect.ts) a full-page redirect straight to Google, finished on
 * /auth/google, so Google's chooser names this site rather than the Supabase project; elsewhere, or if that cannot
 * start, the classic Supabase redirect (`signInClassic`). Either way this resolves `ok` right before the page leaves.
 * Native: system browser via openAuthSessionAsync, then the PKCE `code` in the redirect is exchanged for a session.
 *
 * Failure modes: the provider is not enabled or the redirect URL is not on the project's allow-list (Supabase
 * returns an error, surfaced as `failed`); the user closes the browser (`cancelled`, not an error to show).
 */
export async function signInWithGoogle(): Promise<SignInResult> {
  if (Platform.OS === "web") {
    const origin = window.location.origin;
    if (directSignInAvailable(origin) && (await startDirectSignIn(origin, i18next.language === "en" ? "en" : "iw"))) return { ok: true };
    return signInClassic();
  }

  const redirectTo = Linking.createURL("auth");
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo, skipBrowserRedirect: true },
  });
  if (error || !data.url) return failed;

  const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
  if (result.type !== "success") return { ok: false, reason: result.type === "cancel" || result.type === "dismiss" ? "cancelled" : "failed" };

  const code = Linking.parse(result.url).queryParams?.["code"];
  if (typeof code !== "string") return failed;
  const exchanged = await supabase.auth.exchangeCodeForSession(code);
  return exchanged.error ? failed : { ok: true };
}

/**
 * The classic web sign-in: Supabase's own redirect through Google (Google's chooser then names the Supabase
 * project). The fallback when the direct flow cannot start or fails on /auth/google. Web only.
 */
export async function signInClassic(): Promise<SignInResult> {
  const { error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: window.location.origin },
  });
  return error ? failed : { ok: true };
}
