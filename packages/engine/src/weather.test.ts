import { describe, expect, it } from "vitest";
import { OpenMeteoHourlySchema } from "@fit-check/schema";
import sample from "../__fixtures__/open-meteo-2026-11-08.json";
import { skyGroup, summarizeDay } from "./weather";

// A real response for Giv'at Shmuel on 2026-11-08 (a showery autumn day), recorded so the test never hits the network.
const forecast = OpenMeteoHourlySchema.parse(sample);

describe("summarizeDay", () => {
  it("summarizes the 07:00-19:00 window of the real sample", () => {
    expect(summarizeDay(forecast, "2026-11-08")).toEqual({
      temp_min_c: 16,
      temp_max_c: 21,
      rain_probability: 0.63,
      wind_max_kmh: 12,
      uv_max: 2.8,
      sky: "showers",
      hours: 13,
    });
  });

  it("ignores the night: the 15.1C at 23:00 is outside the window", () => {
    expect(summarizeDay(forecast, "2026-11-08")!.temp_min_c).toBe(16);
  });

  it("returns null for a date the forecast does not cover", () => {
    expect(summarizeDay(forecast, "2026-11-09")).toBeNull();
  });

  it("skips null samples instead of turning them into 0C", () => {
    const holey = OpenMeteoHourlySchema.parse({
      ...sample,
      hourly: { ...sample.hourly, apparent_temperature: sample.hourly.apparent_temperature.map((v, i) => (i === 7 ? null : v)) },
    });
    expect(summarizeDay(holey, "2026-11-08")!.hours).toBe(12);
  });
});

describe("OpenMeteoHourlySchema", () => {
  it("rejects arrays of different lengths", () => {
    const broken = { ...sample, hourly: { ...sample.hourly, uv_index: [1, 2] } };
    expect(OpenMeteoHourlySchema.safeParse(broken).success).toBe(false);
  });
});

describe("skyGroup", () => {
  it("maps WMO codes by what you dress for", () => {
    expect(skyGroup(0)).toBe("clear");
    expect(skyGroup(3)).toBe("cloudy");
    expect(skyGroup(61)).toBe("rain");
    expect(skyGroup(80)).toBe("showers");
    expect(skyGroup(95)).toBe("storm");
  });
});
