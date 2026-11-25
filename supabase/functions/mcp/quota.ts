import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { allowanceFor, ownerIdFromEnv, percentUsed, quotaState } from "../_shared/quota.ts";
import type { ToolContext, ToolResult } from "./tools.ts";

const QuotaInput = z
  .object({
    email: z.string().trim().toLowerCase().email(),
    extra_usd: z.number().min(0).max(50).optional(),
    extra_cutouts: z.number().int().min(0).max(2000).optional(),
    note: z.string().trim().max(200).optional(),
  })
  .strict();

const text = (value: unknown): ToolResult => ({ content: [{ type: "text", text: JSON.stringify(value, null, 2) }] });
const fail = (message: string): ToolResult => ({ content: [{ type: "text", text: message }], isError: true });

/** The user with this email, through the auth admin API (auth.users is not exposed to PostgREST). */
async function findUser(db: SupabaseClient, email: string): Promise<{ id: string; email: string } | null> {
  // don't touch / a page cap: listUsers has no email filter, and an unbounded loop on a large project would run
  // the function into its wall clock instead of answering "not found".
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw new Error(error.message);
    const hit = data.users.find((u) => u.email?.toLowerCase() === email);
    if (hit) return { id: hit.id, email };
    if (data.users.length < 1000) return null;
  }
  return null;
}

/**
 * quota_set: the owner reads or changes one user's monthly allowance (Roy, 2026-11-25: "I open more for them when
 * they ask"). Without extra_usd / extra_cutouts it only reads. Values are absolute: the extra on top of the
 * defaults, replacing what was there, so "two dollars more" means reading first and adding.
 *
 * Failure modes: a caller who is not OWNER_USER_ID (or OWNER_USER_ID unset) is refused; an unknown email, the
 * owner's own email (no personal limit) and a failed write are typed errors.
 */
export async function quotaSet(args: unknown, ctx: ToolContext): Promise<ToolResult> {
  const ownerId = ownerIdFromEnv();
  if (ownerId === null || ctx.userId !== ownerId) return fail("Only the app's owner can read or change allowances.");
  const parsed = QuotaInput.safeParse(args ?? {});
  if (!parsed.success) return fail(`Invalid input: ${parsed.error.issues.map((i) => i.message).join("; ")}`);
  const input = parsed.data;

  let user: { id: string; email: string } | null;
  try {
    user = await findUser(ctx.db, input.email);
  } catch (error) {
    return fail(`Could not look the user up: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!user) return fail(`No user signed up with ${input.email}.`);
  if (user.id === ownerId) return fail("The owner has no personal limit; only the account-wide caps apply.");

  if (input.extra_usd !== undefined || input.extra_cutouts !== undefined) {
    const { data: current } = await ctx.db.from("user_quotas").select("extra_usd, extra_cutouts").eq("user_id", user.id).maybeSingle();
    const { error } = await ctx.db.from("user_quotas").upsert({
      user_id: user.id,
      extra_usd: input.extra_usd ?? Number(current?.extra_usd ?? 0),
      extra_cutouts: input.extra_cutouts ?? Number(current?.extra_cutouts ?? 0),
      ...(input.note !== undefined ? { note: input.note } : {}),
      updated_at: new Date().toISOString(),
    });
    if (error) return fail(`Could not save the allowance: ${error.message}`);
  }

  const state = await quotaState(user.id);
  const allowance = state.allowance ?? allowanceFor(user.id, ownerId, null);
  return text({
    email: user.email,
    changed: input.extra_usd !== undefined || input.extra_cutouts !== undefined,
    allowance_this_month: allowance,
    used_this_month: state.usage,
    percent_used: state.usage && allowance ? percentUsed(state.usage, allowance) : null,
  });
}
