import { DayContextSchema, OCCASION_TYPES, type OccasionSource, type OccasionType } from "@fit-check/schema";
import { z } from "zod";

/** What is on a date, as the screen uses it (DESIGN.md "שלב 4.5"): the occasion, its short label, who set it. */
export type Occasion = { type: OccasionType; label?: string; source: OccasionSource };

/** One `contexts` row as read for occasions; `payload` is kept so a rewrite can keep keys other writers put there. */
export type OccasionRow = Occasion & { date: string; payload: Record<string, unknown>; createdAt: string };

const RawRowSchema = z.object({
  date: z.string(),
  type: z.string(),
  source: z.string(),
  payload: z.unknown(),
  created_at: z.string(),
});
const PayloadSchema = z.record(z.unknown());

/**
 * Rows from `contexts` to the occasion in effect per date: only the three occasion types, validated with the shared
 * day-context schema (a row that fails it, or a `hebcal` row, is skipped), and the newest row wins per date (two rows
 * exist for a moment when a write's cleanup failed: PRD 7.1, the server's context_set). Pure.
 *
 * @param rows Raw rows (any order).
 * @param dates The dates on screen; each gets an entry, null when it has no occasion.
 * @returns date -> the newest valid occasion row, or null.
 */
export function occasionsFromRows(rows: readonly unknown[], dates: readonly string[]): Record<string, OccasionRow | null> {
  const out: Record<string, OccasionRow | null> = Object.fromEntries(dates.map((d) => [d, null]));
  for (const raw of rows) {
    const row = RawRowSchema.safeParse(raw);
    if (!row.success || !(row.data.date in out)) continue;
    const payload = PayloadSchema.safeParse(row.data.payload);
    const body = payload.success ? payload.data : {};
    const label = typeof body.label === "string" ? body.label : undefined;
    const parsed = DayContextSchema.safeParse({ type: row.data.type, date: row.data.date, label, source: row.data.source });
    // A label that breaks the shared rules (too long, two lines) is dropped, not the whole occasion.
    const valid = parsed.success
      ? parsed.data
      : DayContextSchema.safeParse({ type: row.data.type, date: row.data.date, source: row.data.source }).data;
    if (!valid) continue;
    const current = out[valid.date];
    if (current && current.createdAt >= row.data.created_at) continue;
    out[valid.date] = { type: valid.type, label: valid.label, source: valid.source, date: valid.date, payload: body, createdAt: row.data.created_at };
  }
  return out;
}

/**
 * Applies the answer of a read to what is on screen, except for dates the user changed (chose, cleared, or a write
 * settled) after that read started: their answer is older than the user's choice and must not undo it. Pure.
 *
 * @param current What is on screen now.
 * @param read The read's answer, per date (only dates in it are touched).
 * @param startedAt The per-date change counters when the read started.
 * @param changesNow The per-date change counters now.
 */
export function mergeOccasionRead<T>(
  current: Readonly<Record<string, T>>,
  read: Readonly<Record<string, T>>,
  startedAt: Readonly<Record<string, number>>,
  changesNow: Readonly<Record<string, number>>
): Record<string, T> {
  const out: Record<string, T> = { ...current };
  for (const [date, value] of Object.entries(read)) {
    if ((changesNow[date] ?? 0) !== (startedAt[date] ?? 0)) continue;
    out[date] = value;
  }
  return out;
}

/** The other occasion types of a date, which a write removes after storing its own (one occasion per date). */
export function otherOccasionTypes(type: OccasionType): OccasionType[] {
  return OCCASION_TYPES.filter((t) => t !== type);
}

/**
 * The payload a manual write stores: what the row of that type already held, minus its label (a label from a
 * different event would be wrong), as the server's context_set does. Nothing about a person is ever added.
 */
export function manualPayload(existing: OccasionRow | null, type: OccasionType): Record<string, unknown> {
  if (!existing || existing.type !== type) return {};
  const { label: _label, ...kept } = existing.payload;
  return kept;
}
