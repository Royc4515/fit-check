import { describe, expect, it } from "vitest";
import { manualPayload, occasionsFromRows, otherOccasionTypes } from "./occasionRows";

const row = (over: Record<string, unknown> = {}) => ({ date: "2026-11-20", type: "interview", source: "manual", payload: {}, created_at: "2026-11-19T10:00:00Z", ...over });

describe("occasionsFromRows", () => {
  it("every date on screen gets an entry, null without an occasion", () => {
    expect(occasionsFromRows([], ["2026-11-20", "2026-11-21"])).toEqual({ "2026-11-20": null, "2026-11-21": null });
  });
  it("reads type, label and source", () => {
    const r = occasionsFromRows([row({ source: "calendar", payload: { label: "ראיון עבודה" } })], ["2026-11-20"])["2026-11-20"];
    expect(r).toMatchObject({ type: "interview", label: "ראיון עבודה", source: "calendar" });
  });
  it("the newest row wins per date, whatever the order", () => {
    const rows = [row({ type: "date", created_at: "2026-11-19T09:00:00Z" }), row({ type: "event", created_at: "2026-11-19T11:00:00Z" }), row()];
    expect(occasionsFromRows(rows, ["2026-11-20"])["2026-11-20"]?.type).toBe("event");
  });
  it("skips calendar day types, hebcal rows, other dates and broken rows", () => {
    const rows = [row({ type: "shabbat" }), row({ source: "hebcal" }), row({ date: "2026-11-22" }), { nonsense: true }, row({ type: "trip" })];
    expect(occasionsFromRows(rows, ["2026-11-20"])["2026-11-20"]).toBeNull();
  });
  it("a label that breaks the shared rules is dropped, the occasion stays", () => {
    const r = occasionsFromRows([row({ payload: { label: "two\nlines" } })], ["2026-11-20"])["2026-11-20"];
    expect(r?.type).toBe("interview");
    expect(r?.label).toBeUndefined();
  });
});

describe("writing", () => {
  it("removes the other two occasion types", () => expect(otherOccasionTypes("date")).toEqual(["interview", "event"]));
  it("keeps the same-type row's payload without its label, and nothing from another type", () => {
    const existing = occasionsFromRows([row({ payload: { label: "x", note: 1 } })], ["2026-11-20"])["2026-11-20"]!;
    expect(manualPayload(existing, "interview")).toEqual({ note: 1 });
    expect(manualPayload(existing, "date")).toEqual({});
    expect(manualPayload(null, "date")).toEqual({});
  });
});
