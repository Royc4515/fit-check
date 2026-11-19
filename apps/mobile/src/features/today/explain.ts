import type { CandidateOutfit } from "@fit-check/schema";
import type { TFunction } from "i18next";
import type { DayContext } from "../../data/dayContext";

/** Rain worth mentioning: below this a coat suggestion is noise (Israel forecasts carry a lot of 20-30% hours). */
const RAIN_MENTION = 0.4;

export type Explanation = {
  /** One short sentence, set large as the pull quote. */
  lead: string;
  /** Practical notes (layer, rain, Shabbat), set small under it. */
  notes: string[];
};

/**
 * Plain, true statements about why this outfit, built from facts the engine used. Stands in for the AI stylist
 * (PLAN.md phase B) and stays as its fallback when the model's output fails validation. Split in two because a
 * pull quote only works when it is one sentence.
 */
export function explainOutfit(t: TFunction, ctx: Pick<DayContext, "weather" | "dayType">, outfit: CandidateOutfit, dayLabel: string): Explanation {
  const w = ctx.weather;
  const lead = w ? t("today.explain.base", { day: dayLabel, min: w.temp_min_c, max: w.temp_max_c }) : t("today.explain.noWeather", { day: dayLabel });
  const notes: string[] = [];
  if (outfit.items.some((i) => i.slot === "layer")) notes.push(t("today.explain.layer"));
  if (w && w.rain_probability >= RAIN_MENTION) notes.push(t("today.explain.rain"));
  if (ctx.dayType !== "weekday") notes.push(t("today.explain.shabbat"));
  return { lead, notes };
}
