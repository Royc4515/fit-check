import { Platform } from "react-native";

/**
 * The consent request a signed-out user was looking at when they went to sign in with Google.
 *
 * don't touch / web sign-in is a full-page redirect back to the site root (the only redirect URL on the allow-list),
 * so the `authorization_id` in the consent URL would be lost. It waits here and the root layout sends the user back to
 * /oauth/consent once signed in. Native never hosts the consent page, so this is web-only.
 */
const KEY = "fitcheck.oauth.pending";

export function savePendingConsent(authorizationId: string): void {
  if (Platform.OS !== "web") return;
  try {
    window.sessionStorage.setItem(KEY, authorizationId);
  } catch {
    // Private mode or blocked storage: the user can start the connection from Claude again.
  }
}

/** Returns the waiting authorization id once and forgets it, so a later visit to the root is not hijacked. */
export function takePendingConsent(): string | null {
  if (Platform.OS !== "web") return null;
  try {
    const id = window.sessionStorage.getItem(KEY);
    window.sessionStorage.removeItem(KEY);
    return id;
  } catch {
    return null;
  }
}
