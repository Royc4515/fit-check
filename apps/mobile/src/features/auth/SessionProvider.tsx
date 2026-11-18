import type { Session } from "@supabase/supabase-js";
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { AppState } from "react-native";
import { isPreview, PREVIEW_OWNER } from "../../data/preview";
import { supabase } from "../../lib/supabase";

/**
 * `loading` is the first read from storage: rendering the sign-in screen then would flash it at signed-in users.
 * `preview` is the temporary read-only design preview on web (data/preview.ts): the signed-in screens render with the
 * owner's id and no Supabase session at all.
 */
export type SessionState =
  | { status: "loading" }
  | { status: "signedOut" }
  | { status: "signedIn"; session: Session }
  | { status: "preview"; userId: string };

/** The user whose wardrobe the signed-in screens show: the session's user, or the owner in the design preview. */
export function sessionUserId(state: SessionState): string | null {
  if (state.status === "signedIn") return state.session.user.id;
  if (state.status === "preview") return state.userId;
  return null;
}

const SessionContext = createContext<SessionState>({ status: "loading" });

export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  // Fixed for the page's lifetime (read once), so hooks below never change order.
  const preview = isPreview();

  useEffect(() => {
    // Design preview: no auth at all, not even a stored session of whoever owns this browser.
    if (preview) return;
    let active = true;
    void supabase.auth.getSession().then(({ data }) => {
      if (active) setSession(data.session);
    });
    const { data } = supabase.auth.onAuthStateChange((_event, next) => setSession(next));

    // don't touch / React Native timers are suspended in the background, so token refresh must be started and
    // stopped with the app state or a session silently expires while the app sleeps. (supabase-js docs)
    const appState = AppState.addEventListener("change", (state) => {
      if (state === "active") void supabase.auth.startAutoRefresh();
      else void supabase.auth.stopAutoRefresh();
    });

    return () => {
      active = false;
      data.subscription.unsubscribe();
      appState.remove();
    };
  }, [preview]);

  const value = useMemo<SessionState>(() => {
    if (preview) return { status: "preview", userId: PREVIEW_OWNER };
    return session === undefined ? { status: "loading" } : session ? { status: "signedIn", session } : { status: "signedOut" };
  }, [preview, session]);
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionState {
  return useContext(SessionContext);
}
