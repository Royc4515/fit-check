import AsyncStorage from "@react-native-async-storage/async-storage";
import { REFERRAL_CODE_RE } from "@fit-check/schema";
import { cacheGet, cacheSet } from "../../data/kv";

const KEY = "fitcheck.referral.pending";
/** A code waits this long for its sign-in; the server would refuse an older account anyway (NEW_ACCOUNT_DAYS). */
const MAX_AGE_MS = 7 * 86_400_000;

/**
 * Keeps the referral code a visitor arrived with (/join/<code>) until they are signed in. AsyncStorage, which is
 * localStorage on web: web sign-in is a full-page redirect, and a new user may sign in from another tab or come back
 * the next day. Codes that are not well formed are ignored.
 */
export async function rememberReferral(code: string): Promise<void> {
  const clean = code.trim().toLowerCase();
  if (REFERRAL_CODE_RE.test(clean)) await cacheSet(KEY, clean);
}

/**
 * The waiting code, removed as it is read: a claim is tried once per sign-in, and a refused claim (own code, old
 * account) must not be retried on every launch. Null when none waits or storage is blocked.
 */
export async function takeReferral(): Promise<string | null> {
  const code = await cacheGet<string>(KEY, MAX_AGE_MS);
  try {
    await AsyncStorage.removeItem(KEY);
  } catch {
    // Blocked storage: nothing was stored either, so nothing waits to be retried.
  }
  return code !== null && REFERRAL_CODE_RE.test(code) ? code : null;
}

/**
 * Claims the waiting code, if any, for the signed-in user. Called once a session exists (root layout) and by /join
 * when the visitor is already signed in. A claim that never reached the server is kept for the next sign-in; every
 * answer the server gave (counted or refused) ends it. Never throws.
 */
export async function claimPendingReferral(claim: (code: string) => Promise<{ ok: boolean; reason?: string }>): Promise<void> {
  const code = await takeReferral();
  if (code === null) return;
  const result = await claim(code);
  if (!result.ok && result.reason === "network") await rememberReferral(code);
}
