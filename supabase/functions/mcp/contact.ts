import { z } from "zod";
import { ownerIdFromEnv } from "../_shared/quota.ts";
import type { ToolContext, ToolResult } from "./tools.ts";

const ContactListInput = z
  .object({
    include_handled: z.boolean().optional(),
    mark_handled: z.array(z.number().int().positive()).max(50).optional(),
  })
  .strict();

const text = (value: unknown): ToolResult => ({ content: [{ type: "text", text: JSON.stringify(value, null, 2) }] });
const fail = (message: string): ToolResult => ({ content: [{ type: "text", text: message }], isError: true });

/**
 * contact_requests: the owner reads what users sent through the app's "contact Roy" form, newest first, and closes
 * the ones he dealt with (`mark_handled`). Open requests only unless include_handled. Each row carries the sender's
 * email, so a quota request leads straight to quota_set.
 *
 * Failure modes: a caller who is not OWNER_USER_ID is refused; a read or write failure is a typed error.
 */
export async function contactRequests(args: unknown, ctx: ToolContext): Promise<ToolResult> {
  const ownerId = ownerIdFromEnv();
  if (ownerId === null || ctx.userId !== ownerId) return fail("Only the app's owner can read contact requests.");
  const parsed = ContactListInput.safeParse(args ?? {});
  if (!parsed.success) return fail(`Invalid input: ${parsed.error.issues.map((i) => i.message).join("; ")}`);
  const input = parsed.data;

  if (input.mark_handled?.length) {
    const { error } = await ctx.db.from("contact_requests").update({ handled_at: new Date().toISOString() }).in("id", input.mark_handled).is("handled_at", null);
    if (error) return fail(`Could not mark them handled: ${error.message}`);
  }

  let query = ctx.db.from("contact_requests").select("id, user_id, kind, message, emailed, handled_at, created_at").order("created_at", { ascending: false }).limit(50);
  if (!input.include_handled) query = query.is("handled_at", null);
  const { data, error } = await query;
  if (error) return fail(`Could not read contact requests: ${error.message}`);
  const rows = data ?? [];

  const emails = new Map<string, string | null>();
  for (const id of new Set(rows.map((r) => r.user_id as string))) {
    const { data: user } = await ctx.db.auth.admin.getUserById(id);
    emails.set(id, user.user?.email ?? null);
  }
  return text({
    marked_handled: input.mark_handled ?? [],
    requests: rows.map((r) => ({
      id: r.id,
      from: emails.get(r.user_id as string) ?? r.user_id,
      kind: r.kind,
      message: r.message,
      emailed: r.emailed,
      handled: r.handled_at !== null,
      sent_at: r.created_at,
    })),
  });
}
