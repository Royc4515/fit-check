import { DETECT_MODEL, ENHANCE_MODEL } from "./gemini.ts";
import { sumAiCost } from "./log.ts";

/**
 * The money guard for paid Google calls: the monthly Google Cloud credit from Google AI Pro (Roy: no real money).
 * Counted across all users from ai_calls, because the credit belongs to the project, not to a user. Past it,
 * detection drops to the free tier and redraws stop. Shared by intake-separate and the mcp function.
 */
export const MONTHLY_GOOGLE_BUDGET_USD = 8;

/** Paid Google spend since the 1st of this month (UTC); null when it cannot be read, which callers treat as spent. */
export async function monthlyGoogleSpend(): Promise<number | null> {
  const now = new Date();
  const since = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const [enhance, detect] = await Promise.all([sumAiCost(ENHANCE_MODEL, since), sumAiCost(DETECT_MODEL, since)]);
  return enhance === null || detect === null ? null : enhance + detect;
}
