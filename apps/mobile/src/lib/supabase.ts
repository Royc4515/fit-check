import AsyncStorage from "@react-native-async-storage/async-storage";
import { createClient } from "@supabase/supabase-js";
import { Platform } from "react-native";

const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const anon = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

if (!url || !anon) {
  // Fail loudly at startup rather than at the first query; a missing env is a setup error.
  throw new Error("EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY must be set (see .env.example)");
}

const isWeb = Platform.OS === "web";

/** The only Supabase client in the app. Service-role work happens in Edge Functions. */
export const supabase = createClient(url, anon, {
  auth: {
    // don't touch / without a storage adapter, supabase-js on React Native keeps the session in memory only, so
    // every app launch would sign the user out. On web the default (localStorage) is right, and passing
    // AsyncStorage during the static export's server render would touch `window` that does not exist.
    storage: isWeb ? undefined : AsyncStorage,
    persistSession: true,
    autoRefreshToken: true,
    // don't touch / supabase-js 2.x defaults to the implicit flow, which returns tokens in the URL hash. The
    // native sign-in (features/auth/signIn.ts) exchanges a PKCE `?code=` instead, which also keeps tokens out of
    // URLs and browser history. Without this line native sign-in fails with "failed" on every attempt.
    flowType: "pkce",
    // Web returns from Google with the code in the URL and supabase-js exchanges it. Native handles the
    // redirect itself in features/auth/signIn.ts, so detecting there would race it.
    detectSessionInUrl: isWeb,
  },
});
