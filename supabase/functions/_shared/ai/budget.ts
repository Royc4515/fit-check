import { DETECT_MODEL, ENHANCE_MODEL } from "./gemini.ts";
import { sumAiCost } from "./log.ts";
import { TRYON_MODEL } from "./tryon.ts";

/**
 * The money guard for paid Google calls: the monthly Google Cloud credit from Google AI Pro (Roy: no real money).
 * Counted across all users from ai_calls, because the credit belongs to the project, not to a user. Past it,
 * detection drops to the free tier, and redraws and try-on images stop. Shared by intake-separate, mcp and tryon.
 */
export const MONTHLY_GOOGLE_BUDGET_USD = 8;

/**
 * Every paid Google model that writes its cost to ai_calls. A model missing here would spend outside the cap.
 * don't touch / TRYON_MODEL added 2026-11-19 (stage 5.3): try-on shares the redraw's credit and cap.
 */
const PAID_GOOGLE_MODELS = [ENHANCE_MODEL, DETECT_MODEL, TRYON_MODEL] as const;

/** Paid Google spend since the 1st of this month (UTC); null when it cannot be read, which callers treat as spent. */
export async function monthlyGoogleSpend(): Promise<number | null> {
  const now = new Date();
  const since = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const sums = await Promise.all(PAID_GOOGLE_MODELS.map((model) => sumAiCost(model, since)));
  let total = 0;
  for (const s of sums) {
    if (s === null) return null;
    total += s;
  }
  return total;
}

/**
 * Whether a paid call of `priceUsd` may start: the month's spend plus this call must stay within the cap.
 * Unknown spend (null) never allows a call (the money rule: unknown counts as spent). Pure, so the rule is tested
 * without a database. The redraw paths still use their older `spent >= cap` check; try-on uses this one.
 */
export function googleBudgetAllows(spent: number | null, priceUsd: number, capUsd = MONTHLY_GOOGLE_BUDGET_USD): boolean {
  return spent !== null && spent + priceUsd <= capUsd;
}
