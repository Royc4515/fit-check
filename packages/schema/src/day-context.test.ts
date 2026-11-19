import { describe, expect, it } from "vitest";
import { DayContextSchema, OccasionLabelSchema, daysBetween, occasionDateWindowError, planDay } from "./day-context";

const base = { type: "interview", date: "2026-11-20", source: "calendar" } as const;

describe("DayContextSchema", () => {
  it("accepts the three occasion types, with and without a label", () => {
    for (const type of ["date", "interview", "event"] as const) {
      expect(DayContextSchema.safeParse({ ...base, type }).success).toBe(true);
    }
    expect(DayContextSchema.parse({ ...base, label: "job interview" }).label).toBe("job interview");
  });

  it("rejects types outside the three", () => {
    for (const type of ["weekday", "shabbat", "holiday", "reserve", "trip", "party", ""]) {
      expect(DayContextSchema.safeParse({ ...base, type }).success, type).toBe(false);
    }
  });

  it("rejects a source other than manual or calendar", () => {
    expect(DayContextSchema.safeParse({ ...base, source: "hebcal" }).success).toBe(false);
  });

  it("rejects impossible and malformed dates", () => {
    for (const date of ["2026-02-30", "2026-13-01", "2026-00-10", "2027-02-29", "26-11-20", "2026-11-20T10:00:00Z", "tomorrow", ""]) {
      expect(DayContextSchema.safeParse({ ...base, date }).success, date).toBe(false);
    }
    expect(DayContextSchema.safeParse({ ...base, date: "2028-02-29" }).success).toBe(true);
  });
});

describe("OccasionLabelSchema", () => {
  it("trims, and counts the length after the trim", () => {
    expect(OccasionLabelSchema.parse("  ראיון עבודה  ")).toBe("ראיון עבודה");
    expect(OccasionLabelSchema.safeParse("a".repeat(60)).success).toBe(true);
    expect(OccasionLabelSchema.safeParse(` ${"a".repeat(60)} `).success).toBe(true);
    expect(OccasionLabelSchema.safeParse("a".repeat(61)).success).toBe(false);
  });

  it("rejects an empty or whitespace-only label", () => {
    expect(OccasionLabelSchema.safeParse("").success).toBe(false);
    expect(OccasionLabelSchema.safeParse("   \t ").success).toBe(false);
  });

  it("rejects a label with a line break inside, accepts one that only trims away", () => {
    for (const label of ["two\nlines", "two\r\nlines", "a\rb", "a\u2028b", "a\u2029b"]) {
      expect(OccasionLabelSchema.safeParse(label).success, JSON.stringify(label)).toBe(false);
    }
    expect(OccasionLabelSchema.parse("one line\n")).toBe("one line");
  });
});

describe("occasionDateWindowError", () => {
  const today = "2026-11-19";
  it("accepts yesterday through 14 days ahead", () => {
    for (const date of ["2026-11-18", "2026-11-19", "2026-11-20", "2026-12-03"]) {
      expect(occasionDateWindowError(date, today), date).toBeNull();
    }
  });
  it("rejects 15 days ahead and 2 days back", () => {
    expect(occasionDateWindowError("2026-12-04", today)).toMatch(/15 days ahead/);
    expect(occasionDateWindowError("2026-11-17", today)).toMatch(/2 days in the past/);
  });
  it("counts across a month and a year boundary", () => {
    expect(daysBetween("2026-12-30", "2027-01-02")).toBe(3);
    expect(occasionDateWindowError("2027-01-13", "2026-12-30")).toBeNull();
    expect(occasionDateWindowError("2027-01-14", "2026-12-30")).not.toBeNull();
  });
});

describe("planDay", () => {
  const none = { occasion: null, dayTypeForced: false } as const;

  it("uses the calendar day type when nothing else applies", () => {
    expect(planDay({ ...none, dayType: "shabbat", observesShabbat: true })).toEqual({ rules: "shabbat", formality_steps: 0, reason: "shabbat" });
    expect(planDay({ ...none, dayType: "weekday", observesShabbat: true }).rules).toBe("weekday");
  });

  it("an occasion beats the calendar, and says where it came from", () => {
    const plan = planDay({ dayType: "weekday", dayTypeForced: false, observesShabbat: true, occasion: { type: "interview", source: "calendar" } });
    expect(plan).toEqual({ rules: "interview", formality_steps: 0, reason: "interview, set from the calendar" });
    const manual = planDay({ dayType: "shabbat", dayTypeForced: false, observesShabbat: true, occasion: { type: "event", label: "wedding", source: "manual" } });
    expect(manual.rules).toBe("event");
    expect(manual.reason).toBe('event ("wedding"), set by hand');
  });

  it("an explicit day type beats the occasion and the setting", () => {
    const plan = planDay({ dayType: "shabbat", dayTypeForced: true, observesShabbat: false, occasion: { type: "date", source: "manual" } });
    expect(plan.rules).toBe("shabbat");
    expect(plan.formality_steps).toBe(0);
  });

  it("observance off: Shabbat is a weekday, a holiday a weekday one step dressier", () => {
    expect(planDay({ ...none, dayType: "shabbat", observesShabbat: false })).toMatchObject({ rules: "weekday", formality_steps: 0 });
    expect(planDay({ ...none, dayType: "holiday", observesShabbat: false })).toMatchObject({ rules: "weekday", formality_steps: 1 });
    expect(planDay({ ...none, dayType: "weekday", observesShabbat: false })).toMatchObject({ rules: "weekday", formality_steps: 0 });
  });

  it("observance off does not stop an occasion", () => {
    expect(planDay({ dayType: "shabbat", dayTypeForced: false, observesShabbat: false, occasion: { type: "date", source: "calendar" } }).rules).toBe("date");
  });
});
