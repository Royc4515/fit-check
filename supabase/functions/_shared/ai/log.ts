import { createClient } from "@supabase/supabase-js";
import type { AiLogEntry } from "./types.ts";

/**
 * Writes one `ai_calls` row (CLAUDE.md: every AI call is logged, success or not; cost visibility is a feature).
 * Uses the service role because ai_calls has a read-only policy for users: a client must never be able to
 * write (or erase) its own cost record. A logging failure is printed, never thrown: it must not fail the call
 * the user is waiting for.
 */
export async function logAiCall(userId: string | null, entry: AiLogEntry): Promise<void> {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) {
    console.error("logAiCall: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing");
    return;
  }
  const admin = createClient(url, key, { auth: { persistSession: false } });
  const { error } = await admin.from("ai_calls").insert({ user_id: userId, ...entry });
  if (error) console.error("logAiCall failed", error);
}

/**
 * How many calls of one task this user made since `since` (for the daily cap). Service role, same reason as above.
 * Fails closed: if the count cannot be read, the caller treats the cap as reached.
 */
export async function countAiCalls(userId: string, task: AiLogEntry["task"], since: Date): Promise<number | null> {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) return null;
  const admin = createClient(url, key, { auth: { persistSession: false } });
  const { count, error } = await admin
    .from("ai_calls")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("task", task)
    .gte("created_at", since.toISOString());
  return error ? null : count ?? 0;
}
