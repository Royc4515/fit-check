import * as Linking from "expo-linking";
import * as WebBrowser from "expo-web-browser";
import { Platform } from "react-native";
import { supabase } from "../../lib/supabase";

// Lets the popup/redirect page on web hand its result back to the opener; a no-op on native.
WebBrowser.maybeCompleteAuthSession();

export type SignInResult = { ok: true } | { ok: false; reason: "cancelled" | "failed" };

const failed: SignInResult = { ok: false, reason: "failed" };

/**
 * Google sign-in through Supabase Auth.
 *
 * Web: a full-page redirect; supabase-js finishes the exchange when the page loads again (`detectSessionInUrl`),
 * so this resolves `ok` right before the page navigates away.
 * Native: system browser via openAuthSessionAsync, then the PKCE `code` in the redirect is exchanged for a session.
 *
 * Failure modes: the provider is not enabled or the redirect URL is not on the project's allow-list (Supabase
 * returns an error, surfaced as `failed`); the user closes the browser (`cancelled`, not an error to show).
 */
export async function signInWithGoogle(): Promise<SignInResult> {
  if (Platform.OS === "web") {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: window.location.origin },
    });
    return error ? failed : { ok: true };
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
