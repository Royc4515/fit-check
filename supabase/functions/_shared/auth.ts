import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createLocalJWKSet, jwtVerify } from "jose";

export type AuthResult = { ok: true; userId: string } | { ok: false; detail: string };

/**
 * Identifies the signed-in caller of an Edge Function by verifying their JWT locally against the project's signing
 * keys (SUPABASE_JWKS, ES256), with the issuer and audience Supabase Auth sets. No network call.
 *
 * don't touch / local on purpose (2026-11-08): from inside the Edge runtime, every request to Supabase that carried
 * the user's real token (getUser, getClaims, storage as the user) came back as an HTML page, while the same calls
 * without it worked. So the token is checked here and never forwarded; data access goes through `adminClient()`
 * with explicit ownership checks in each function.
 * Failure details are logged (never the token) so a 401 explains itself in the function logs.
 */
export async function authenticate(req: Request): Promise<AuthResult> {
  const url = Deno.env.get("SUPABASE_URL");
  const jwksRaw = Deno.env.get("SUPABASE_JWKS");
  const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!url || !jwksRaw) return fail("server env missing");
  if (!token.startsWith("eyJ")) return fail("no user token");

  try {
    const jwks = createLocalJWKSet(JSON.parse(jwksRaw));
    const { payload } = await jwtVerify(token, jwks, { issuer: `${url}/auth/v1`, audience: "authenticated" });
    if (typeof payload.sub !== "string" || payload.sub.length === 0) return fail("token has no subject");
    return { ok: true, userId: payload.sub };
  } catch (error) {
    return fail(error instanceof Error ? `${error.name}: ${error.message}` : String(error));
  }
}

function fail(detail: string): AuthResult {
  console.error("authenticate failed", detail);
  return { ok: false, detail };
}

/**
 * Service-role client for storage and tables. Bypasses RLS, so every caller must check that the paths and rows it
 * touches belong to the authenticated user (see ownPath in intake-separate).
 */
export function adminClient(): SupabaseClient {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
