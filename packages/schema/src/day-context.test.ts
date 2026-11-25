import { describe, expect, it } from "vitest";
import { DayContextSchema, OccasionLabelSchema, daysBetween, occasionDateWindowError } from "./day-context";

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
