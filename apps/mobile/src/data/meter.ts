import type { Meter } from "@fit-check/schema";

/** From this share on, the screen says the allowance is nearly used (same line as Insights' spend warning). */
export const NEAR_SHARE_PERCENT = 80;

/** Whether a meter is near or past its limit; unknown is neither, so a read failure never alarms. Pure. */
export function meterLevel(meter: Pick<Meter, "percent"> | null): "ok" | "near" | "over" {
  if (meter === null || meter.percent === null) return "ok";
  if (meter.percent >= 100) return "over";
  return meter.percent >= NEAR_SHARE_PERCENT ? "near" : "ok";
}

/** Dollars as the meters show them: two decimals, and a fraction of a cent as $0.01 rather than $0.00. Pure. */
export function dollars(usd: number): string {
  const rounded = Math.round(usd * 100) / 100;
  return `$${(usd > 0 && rounded === 0 ? 0.01 : rounded).toFixed(2)}`;
}
