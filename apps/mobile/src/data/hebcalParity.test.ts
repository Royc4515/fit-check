import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { hebcalDayFacts } from "@fit-check/schema";
import { describe, expect, it } from "vitest";
import { calendarOn } from "./calendarWindow";
import type { HebcalItem } from "./shabbatTimes";

/*
 * The MCP server's `outfit_today` reads a date's Hebrew-calendar facts with the shared `hebcalDayFacts`
 * (packages/schema); Today reads them with `calendarOn`. Both must say the same thing about every date of every real
 * Hebcal answer the app keeps as a fixture, or the server would plan Shabbat, a holiday or Yom Kippur differently.
 */

const dir = join(__dirname, "__fixtures__");
const files = readdirSync(dir).filter((f) => f.endsWith(".json") && !f.startsWith("nominatim"));

describe("hebcalDayFacts agrees with the app's calendar reading", () => {
  it("has real Hebcal answers to compare", () => {
    expect(files.length).toBeGreaterThan(10);
  });

  for (const file of files) {
    it(file, () => {
      const items = (JSON.parse(readFileSync(join(dir, file), "utf8")) as { items: HebcalItem[] }).items;
      const dates = [...new Set(items.map((i) => i.date.slice(0, 10)))];
      for (const date of dates) {
        const app = calendarOn(items, date);
        expect(hebcalDayFacts(items, date), `${file} ${date}`).toEqual({
          yomtov: app.yomtov,
          yomKippur: app.yomKippur,
          havdalahToday: app.end?.day === "today" ? app.end.time : null,
        });
      }
    });
  }
});
