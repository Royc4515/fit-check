import { z } from "zod";

/**
 * Shapes of the public APIs we read (Open-Meteo, Hebcal). Validated at the boundary like any other input
 * (CLAUDE.md): a changed or failed response must fail here, not as NaN three layers down.
 */

const nullableNumbers = z.array(z.number().nullable());

/** Open-Meteo /v1/forecast with the hourly variables Fit Check asks for. Times are local (timezone=Asia/Jerusalem). */
export const OpenMeteoHourlySchema = z
  .object({
    timezone: z.string(),
    hourly: z.object({
      time: z.array(z.string()),
      apparent_temperature: nullableNumbers,
      precipitation_probability: nullableNumbers,
      wind_speed_10m: nullableNumbers,
      uv_index: nullableNumbers,
      weather_code: nullableNumbers,
    }),
  })
  .refine(
    (d) => {
      const n = d.hourly.time.length;
      const h = d.hourly;
      return [h.apparent_temperature, h.precipitation_probability, h.wind_speed_10m, h.uv_index, h.weather_code].every((a) => a.length === n);
    },
    { message: "hourly arrays have different lengths" }
  );

export type OpenMeteoHourly = z.infer<typeof OpenMeteoHourlySchema>;

/** Hebcal /converter?g2h=1. */
export const HebcalConverterSchema = z.object({
  hy: z.number(),
  hm: z.string(),
  hd: z.number(),
  hebrew: z.string(),
});

/** Hebcal /hebcal and /shabbat event lists; only the fields we use. */
export const HebcalItemsSchema = z.object({
  items: z.array(
    z.object({
      title: z.string(),
      date: z.string(),
      category: z.string(),
      title_orig: z.string().optional(),
      hebrew: z.string().optional(),
      yomtov: z.boolean().optional(),
    })
  ),
});
