import type { CandidateOutfit } from "@fit-check/schema";
import type { TFunction } from "i18next";
import type { DayContext } from "../../data/dayContext";

/** Rain worth mentioning: below this a coat suggestion is noise (Israel forecasts carry a lot of 20-30% hours). */
const RAIN_MENTION = 0.4;

/**
 * A plain, true sentence about why this outfit, built from facts the engine used. Stands in for the AI stylist
 * (PLAN.md phase B) and stays as its fallback when the model's output fails validation.
 */
export function explainOutfit(t: TFunction, ctx: DayContext, outfit: CandidateOutfit, dayLabel: string): string {
  const parts: string[] = [];
  const w = ctx.weather;
  parts.push(w ? t("today.explain.base", { day: dayLabel, min: w.temp_min_c, max: w.temp_max_c }) : t("today.explain.noWeather", { day: dayLabel }));
  if (outfit.items.some((i) => i.slot === "layer")) parts.push(t("today.explain.layer"));
  if (w && w.rain_probability >= RAIN_MENTION) parts.push(t("today.explain.rain"));
  if (ctx.dayType !== "weekday") parts.push(t("today.explain.shabbat"));
  return parts.join(" ");
}
