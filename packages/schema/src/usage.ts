import { z } from "zod";

/** One cap or allowance as a bar: what is used, the limit, and the share used (0-100; null when unknown). */
export const MeterSchema = z.object({
  used: z.number().nonnegative().nullable(),
  limit: z.number().nonnegative(),
  percent: z.number().int().min(0).max(100).nullable(),
});
export type Meter = z.infer<typeof MeterSchema>;

/**
 * The `usage` Edge Function's answer (supabase/functions/usage).
 * - `me`: the caller's own monthly allowance. `null` meters mean no personal limit (the owner, or limits off).
 *   `percent` is the fuller of the two meters, which is what the user's bar shows.
 * - `account`: the account-wide caps across all users; only the owner gets it (Roy, 2026-11-25: he sees the
 *   whole account's percentages, not other users' details).
 */
export const UsageResponseSchema = z.union([
  z.object({
    ok: z.literal(true),
    owner: z.boolean(),
    me: z.object({
      ai_usd: MeterSchema.nullable(),
      cutouts: MeterSchema.nullable(),
      percent: z.number().int().min(0).max(100).nullable(),
    }),
    account: z
      .object({
        google_usd: MeterSchema,
        anthropic_usd: MeterSchema,
        cutouts: MeterSchema,
      })
      .nullable(),
  }),
  z.object({ ok: z.literal(false), reason: z.string() }),
]);
export type UsageResponse = z.infer<typeof UsageResponseSchema>;

/**
 * A meter from a used amount and a limit. Pure, shared by the function and its tests.
 * Unknown use (null) has an unknown percent, never 0, so a read failure never looks like an empty month.
 */
export function meterOf(used: number | null, limit: number): Meter {
  const percent = used === null ? null : limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 100;
  return { used: used === null ? null : Math.round(used * 100) / 100, limit, percent };
}
