import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export type AuthResult = { ok: true; userId: string; supabase: SupabaseClient } | { ok: false; detail: string };

/**
 * Identifies the signed-in caller of an Edge Function and returns a Supabase client that acts as them (RLS applies).
 *
 * getClaims(token) verifies the JWT against the project's signing keys (JWKS) without a round trip to the Auth
 * server; getUser(token) is the fallback. don't touch / both need the token passed explicitly: with no argument they
 * look for a stored session, which a server never has, and every call came back 401 (2026-11-08).
 * Failure details are logged (never the token) so the next 401 explains itself in the function logs.
 */
export async function authenticate(req: Request): Promise<AuthResult> {
  const url = Deno.env.get("SUPABASE_URL");
  const anon = Deno.env.get("SUPABASE_ANON_KEY");
  const header = req.headers.get("authorization") ?? "";
  const token = header.replace(/^Bearer\s+/i, "").trim();
  if (!url || !anon) return { ok: false, detail: "server env missing" };
  if (!token) return { ok: false, detail: "no bearer token" };

  const supabase = createClient(url, anon, {
    global: { headers: { authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const claims = await supabase.auth.getClaims(token);
  const sub = claims.data?.claims?.sub;
  if (typeof sub === "string" && sub.length > 0) return { ok: true, userId: sub, supabase };

  const user = await supabase.auth.getUser(token);
  if (user.data.user) return { ok: true, userId: user.data.user.id, supabase };

  const detail = `claims: ${claims.error?.message ?? "no sub"}; user: ${user.error?.message ?? "no user"}`;
  console.error("authenticate failed", detail);
  return { ok: false, detail };
}
