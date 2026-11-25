/**
 * Google sign-in on the app's own domain (web only), so Google's account chooser says "to continue to
 * fit-check-il.vercel.app" instead of the Supabase project's address (Roy, 2026-11-25).
 *
 * How: an OpenID Connect redirect straight to Google (response_type=id_token) that comes back to /auth/google on
 * this site; that page hands the ID token to Supabase (`signInWithIdToken`), which checks its signature, its audience
 * (the project's Google client id) and the nonce. Same Google account, same Supabase user as the classic flow.
 *
 * Only on the origins Google knows as redirect targets (DIRECT_ORIGINS); everywhere else (other previews, native) the
 * classic Supabase redirect runs, and it stays the fallback when this flow fails.
 */

/**
 * The Google OAuth client the Supabase Google provider is configured with. Public by design: it is in every Google
 * sign-in URL; Supabase only accepts ID tokens issued to it.
 */
export const GOOGLE_CLIENT_ID = "1084677713626-bsd0pthngcjitlnre5q89cad48jp3lb0.apps.googleusercontent.com";

/** Where Google sends the user back with the ID token. */
export const CALLBACK_PATH = "/auth/google";

/**
 * Origins whose `<origin>/auth/google` is registered in Google's console as a redirect URI. A redirect to any other
 * would be refused by Google, so those origins keep the classic flow.
 * don't touch / each entry here needs its redirect URI added to the "Fit Check web" OAuth client first.
 */
export const DIRECT_ORIGINS: readonly string[] = [
  "https://fit-check-il.vercel.app",
  // The first production address. vercel.json sends it to the one above; it stays here until its redirect URI is
  // removed from Google, so the site still signs in there if that redirect is ever taken out.
  "https://fit-check-app-xi.vercel.app",
  "https://fit-check-app-git-claude-google-direct-royc4515s-projects.vercel.app",
  "http://localhost:8081",
];

const STORAGE_KEY = "fitcheck:google-direct";
/** A started sign-in older than this is ignored: Google's answer for it would be stale anyway. */
const MAX_AGE_MS = 10 * 60 * 1000;

/** Whether this origin can use the direct flow. Pure. */
export function directSignInAvailable(origin: string): boolean {
  return DIRECT_ORIGINS.includes(origin.replace(/\/+$/, ""));
}

/** Google's authorization URL for an ID token, with the hashed nonce and the state to check on return. Pure. */
export function buildAuthUrl(p: { origin: string; nonceHash: string; state: string; locale: string }): string {
  const q = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    redirect_uri: `${p.origin.replace(/\/+$/, "")}${CALLBACK_PATH}`,
    response_type: "id_token",
    scope: "openid email profile",
    nonce: p.nonceHash,
    state: p.state,
    prompt: "select_account",
    hl: p.locale,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${q.toString()}`;
}

/** What came back in the callback's fragment. Pure. */
export type CallbackParams = { kind: "token"; idToken: string; state: string } | { kind: "error"; error: string } | { kind: "empty" };

export function parseCallback(hash: string): CallbackParams {
  const params = new URLSearchParams(hash.replace(/^#/, ""));
  const error = params.get("error");
  if (error) return { kind: "error", error };
  const idToken = params.get("id_token");
  const state = params.get("state");
  return idToken && state ? { kind: "token", idToken, state } : { kind: "empty" };
}

/** A random URL-safe string (32 bytes) for the nonce and the state. */
export function randomToken(random: (n: number) => Uint8Array = (n) => crypto.getRandomValues(new Uint8Array(n))): string {
  return [...random(32)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** SHA-256 of a string as lowercase hex: what Google gets as `nonce` (Supabase hashes the raw one the same way). */
export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** What a started sign-in keeps until Google answers. */
type Pending = { nonce: string; state: string; at: number };

/** The storage the pending sign-in lives in; sessionStorage on web (this tab only), injectable for tests. */
export type KeyValue = { getItem(k: string): string | null; setItem(k: string, v: string): void; removeItem(k: string): void };

/**
 * Starts the direct sign-in: keeps a fresh nonce and state for this tab, then sends the page to Google. Never throws;
 * false when it could not start (no storage, no crypto), so the caller runs the classic flow instead.
 */
export async function startDirectSignIn(
  origin: string,
  locale: string,
  store: KeyValue = window.sessionStorage,
  go: (url: string) => void = (url) => window.location.assign(url),
  now: () => number = Date.now,
): Promise<boolean> {
  try {
    const nonce = randomToken();
    const state = randomToken();
    const pending: Pending = { nonce, state, at: now() };
    store.setItem(STORAGE_KEY, JSON.stringify(pending));
    go(buildAuthUrl({ origin, nonceHash: await sha256Hex(nonce), state, locale }));
    return true;
  } catch {
    return false;
  }
}

/** Why a callback did not end in a session. */
export type FinishFailure = "cancelled" | "no_pending" | "state_mismatch" | "expired" | "rejected";

/**
 * Finishes the direct sign-in on /auth/google: checks the state against the one this tab started with, then gives
 * the ID token and the raw nonce to Supabase. The pending entry is removed first, so a reload cannot reuse it.
 * Never throws. "cancelled": the user closed Google's chooser; every other failure offers the classic flow.
 */
export async function finishDirectSignIn(
  hash: string,
  signInWithIdToken: (args: { provider: "google"; token: string; nonce: string }) => Promise<{ error: unknown }>,
  store: KeyValue = window.sessionStorage,
  now: () => number = Date.now,
): Promise<{ ok: true } | { ok: false; reason: FinishFailure }> {
  let pending: Pending | null = null;
  try {
    const raw = store.getItem(STORAGE_KEY);
    store.removeItem(STORAGE_KEY);
    pending = raw ? (JSON.parse(raw) as Pending) : null;
  } catch {
    pending = null;
  }
  const params = parseCallback(hash);
  if (params.kind === "error") return { ok: false, reason: params.error === "access_denied" ? "cancelled" : "rejected" };
  if (params.kind === "empty" || pending === null || typeof pending.state !== "string") return { ok: false, reason: "no_pending" };
  if (params.state !== pending.state) return { ok: false, reason: "state_mismatch" };
  if (now() - pending.at > MAX_AGE_MS) return { ok: false, reason: "expired" };
  const { error } = await signInWithIdToken({ provider: "google", token: params.idToken, nonce: pending.nonce });
  return error ? { ok: false, reason: "rejected" } : { ok: true };
}
