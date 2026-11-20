import { describe, expect, it } from "vitest";
import { calendarLine } from "./calendarLine";

const base = { observes: true, known: false, pending: true, wasMissing: true, outdated: false };

describe("calendarLine", () => {
  it("still in flight past the grace: 'still loading', no button (a press could start nothing)", () =>
    expect(calendarLine(base)).toEqual({ kind: "loading" }));
  it("failed or timed out: 'did not load' with try again", () => expect(calendarLine({ ...base, pending: false })).toEqual({ kind: "failed" }));
  it("a retry in flight goes back to 'still loading'", () => {
    expect(calendarLine({ ...base, pending: false })).toEqual({ kind: "failed" });
    expect(calendarLine({ ...base, pending: true })).toEqual({ kind: "loading" });
  });
  it("arrived after being missing: 'has loaded', update only when the outfit breaks its rules", () => {
    expect(calendarLine({ ...base, known: true, pending: false })).toEqual({ kind: "loaded", update: false });
    expect(calendarLine({ ...base, known: true, pending: false, outdated: true })).toEqual({ kind: "loaded", update: true });
  });
  it("known from the start: nothing, unless a refresh changed the day under the outfit", () => {
    expect(calendarLine({ ...base, known: true, wasMissing: false })).toEqual({ kind: "none" });
    expect(calendarLine({ ...base, known: true, wasMissing: false, outdated: true })).toEqual({ kind: "loaded", update: true });
  });
  it("observance off: no line while the calendar is missing", () =>
    expect(calendarLine({ ...base, observes: false, wasMissing: false })).toEqual({ kind: "none" }));
});
