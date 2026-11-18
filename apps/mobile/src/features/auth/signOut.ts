import { Platform } from "react-native";
import { forgetCode, isPreview } from "../../data/preview";
import { supabase } from "../../lib/supabase";

export type SignOutResult = { ok: true } | { ok: false };

/**
 * Signs this device out. The route guard in app/_layout.tsx sees the session end (onAuthStateChange) and returns to
 * sign-in by itself, so nothing here navigates.
 * Scope `local`: only this device's session ends. A global sign-out would also revoke other devices and a Claude
 * connection, which is not what "sign out" on one phone means.
 *
 * Design preview (web, temporary): there is no session. The stored preview code is forgotten and the page reloads at
 * the root, which is then the normal app and shows sign-in (isPreview() is read once per page load, so a reload is
 * the only way out of it).
 *
 * Failure modes: a network or auth error from Supabase resolves `{ ok: false }` and the session stays as it was.
 */
export async function signOut(): Promise<SignOutResult> {
  if (isPreview()) {
    forgetCode();
    if (Platform.OS === "web" && typeof window !== "undefined") window.location.assign("/");
    return { ok: true };
  }
  try {
    const { error } = await supabase.auth.signOut({ scope: "local" });
    return error ? { ok: false } : { ok: true };
  } catch {
    return { ok: false };
  }
}
