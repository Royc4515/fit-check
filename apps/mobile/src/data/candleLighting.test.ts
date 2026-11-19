import { describe, expect, it } from "vitest";
import { candleLightingMinutes, pointInPolygon } from "./candleLighting";

const IL = "Asia/Jerusalem";
const at = (lat: number, lon: number, tz = IL) => candleLightingMinutes({ lat, lon, tz });

describe("pointInPolygon", () => {
  const square = [[0, 0], [4, 0], [4, 4], [0, 4], [0, 0]] as const;
  it("rejects degenerate rings", () => {
    expect(pointInPolygon([1, 1], [])).toBe(false);
    expect(pointInPolygon([1, 1], [[0, 0], [1, 1]])).toBe(false);
  });
  it("handles inside, outside and a concave notch", () => {
    expect(pointInPolygon([2, 2], square)).toBe(true);
    expect(pointInPolygon([5, 2], square)).toBe(false);
    const u = [[0, 0], [6, 0], [6, 6], [4, 6], [4, 2], [2, 2], [2, 6], [0, 6], [0, 0]] as const;
    expect(pointInPolygon([3, 4], u)).toBe(false);
    expect(pointInPolygon([1, 4], u)).toBe(true);
  });
});

describe("candleLightingMinutes: edge cases", () => {
  it("a device outside the Israel time zone gets 18, even for a point in Israel (follows the i=on rule)", () => {
    expect(at(31.7767, 35.2345, "Europe/London")).toBe(18);
  });
  it("New York", () => expect(at(40.7128, -74.006, "America/New_York")).toBe(18));
  it("non-finite coordinates in Israel get 20, not an exception", () => expect(at(Number.NaN, 35, IL)).toBe(20));
});

describe("candleLightingMinutes: Jerusalem 40", () => {
  it("Western Wall plaza", () => expect(at(31.7767, 35.2345)).toBe(40));
  it("Gilo", () => expect(at(31.731, 35.187)).toBe(40));
  it("Mevaseret Zion is its own council: 20", () => expect(at(31.802, 35.15)).toBe(20));
  it("Ma'ale Adumim: 20", () => expect(at(31.777, 35.298)).toBe(20));
  it("Bethlehem side: 20", () => expect(at(31.705, 35.2)).toBe(20));
});

describe("candleLightingMinutes: Haifa and Zikhron 30", () => {
  it("Technion", () => expect(at(32.7775, 35.0217)).toBe(30));
  it("Haifa port", () => expect(at(32.819, 34.999)).toBe(30));
  it("Nesher: 20", () => expect(at(32.766, 35.044)).toBe(20));
  it("Tirat Carmel: 20", () => expect(at(32.76, 34.972)).toBe(20));
  it("Zikhron Ya'akov centre", () => expect(at(32.571, 34.952)).toBe(30));
  it("Binyamina: 20", () => expect(at(32.52, 34.945)).toBe(20));
});

describe("candleLightingMinutes: rest of Israel 20", () => {
  it("Tel Aviv", () => expect(at(32.0809, 34.7806)).toBe(20));
  it("Tel Aviv", () => expect(at(32.0853, 34.7818)).toBe(20));
});
