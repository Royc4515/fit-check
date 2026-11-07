import type { Session } from "@supabase/supabase-js";
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { AppState } from "react-native";
import { supabase } from "../../lib/supabase";

/** `loading` is the first read from storage: rendering the sign-in screen then would flash it at signed-in users. */
export type SessionState = { status: "loading" } | { status: "signedOut" } | { status: "signedIn"; session: Session };

const SessionContext = createContext<SessionState>({ status: "loading" });

export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null | undefined>(undefined);

  useEffect(() => {
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
  }, []);

  const value = useMemo<SessionState>(
    () => (session === undefined ? { status: "loading" } : session ? { status: "signedIn", session } : { status: "signedOut" }),
    [session]
  );
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionState {
  return useContext(SessionContext);
}
