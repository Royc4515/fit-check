import type { TFunction } from "i18next";

/** What was being attempted, so a blocked design-preview write says what did not happen. */
export type FailureKind = "upload" | "save" | "generic";

/** Reasons where trying the same thing again cannot change the answer (a cap, a rejected photo, a missing plan). */
const FINAL_REASONS: ReadonlySet<string> = new Set([
  "preview",
  "daily_limit",
  "monthly_limit",
  "cutout_monthly_limit",
  "too_large",
  "bad_input",
  "no_garments",
  "billing_required",
]);

/** Isolated LTR run, so a status code next to Hebrew is not reordered. */
const ltr = (s: string | number) => `⁦${s}⁩`;

/**
 * The line for a failure reason. A design-preview block gets its own plain sentence per kind; `http_<status>` (an HTTP
 * error with no reason in its body, see data/intake.ts) names the status; every other reason maps to
 * `intake.reason.*` and falls back to the generic line, so nothing renders as a raw key.
 * @param reason - a server reason, `network`, `upload`, `preview`, `http_<status>`, or anything else.
 */
export function failureMessage(t: TFunction, reason: string, kind: FailureKind = "generic"): string {
  if (reason === "preview") return t(`intake.fail.preview.${kind}`);
  const http = /^http_(\d{3})$/.exec(reason);
  if (http?.[1]) return t("intake.fail.http", { status: ltr(http[1]) });
  return t(`intake.reason.${reason}`, { defaultValue: t("intake.reason.unknown") });
}

/** Whether a "try again" action means anything for this reason. */
export function isRetryable(reason: string): boolean {
  return !FINAL_REASONS.has(reason);
}
