import { DETECT_MODEL, ENHANCE_MODEL } from "./gemini.ts";
import { monthStart } from "./cloudflare.ts";
import { sumAiCost, sumProviderCost } from "./log.ts";
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

/**
 * The money guard for Anthropic calls (tagging, the duplicate check, the stylist): Roy's account has $100 of API
 * credit a month (Roy, 2026-11-25). $80 leaves room for the gap between the estimates logged in ai_calls and the real
 * bill, and for other use of the same credit. Counted across all users, like Google's.
 * Past it, intake-tag answers `ai_monthly_limit` (the garment is filled in by hand) and style-outfit answers the
 * same, so the app shows the engine's top candidate without the stylist's words.
 */
export const MONTHLY_ANTHROPIC_BUDGET_USD = 80;

/** Anthropic spend since the 1st of this month (UTC); null when it cannot be read, which callers treat as spent. */
export function monthlyAnthropicSpend(now: Date = new Date()): Promise<number | null> {
  return sumProviderCost("anthropic", monthStart(now));
}

/**
 * Whether an Anthropic call may start. One call costs about a cent at most, so the check is spend below the cap,
 * not spend plus a price: the most a month can pass the cap by is one call. Unknown spend (null) never allows a call.
 */
export function anthropicBudgetAllows(spent: number | null, capUsd = MONTHLY_ANTHROPIC_BUDGET_USD): boolean {
  return spent !== null && spent < capUsd;
}
