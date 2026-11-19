import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { canReuseName, metersBetween, nameFromDevice, nameFromNominatim, parseCachedPlace, roundForLookup, type CachedPlace } from "./placeName";

const fixture = (name: string): unknown => JSON.parse(readFileSync(new URL(`./__fixtures__/nominatim-${name}.json`, import.meta.url), "utf8"));

describe("roundForLookup", () => {
  it("rounds to 3 decimals", () => {
    expect(roundForLookup({ lat: 32.08529, lon: 34.78181 })).toEqual({ lat: 32.085, lon: 34.782 });
  });
  it("keeps negatives and zero", () => {
    expect(roundForLookup({ lat: -33.8688, lon: 0 })).toEqual({ lat: -33.869, lon: 0 });
  });
});

describe("metersBetween", () => {
  it("is zero for the same point", () => {
    expect(metersBetween({ lat: 32, lon: 34 }, { lat: 32, lon: 34 })).toBe(0);
  });
  it("is about 111.2 km per degree of latitude", () => {
    expect(metersBetween({ lat: 32, lon: 34 }, { lat: 33, lon: 34 })).toBeCloseTo(111_195, -2);
  });
  it("is symmetric", () => {
    const a = { lat: 31.778, lon: 35.2354 };
    const b = { lat: 32.0853, lon: 34.7818 };
    expect(metersBetween(a, b)).toBeCloseTo(metersBetween(b, a), 6);
  });
});

describe("canReuseName", () => {
  const base: CachedPlace = { name: "רמת גן", lat: 32.0, lon: 34.8, lang: "he" };
  const at = (dLat: number) => ({ lat: base.lat + dLat, lon: base.lon });
  // Degrees of latitude per metre on the 6371 km sphere the code uses.
  const perMeter = 180 / (Math.PI * 6_371_000);

  it("misses with no cache", () => {
    expect(canReuseName(null, at(0), "he")).toBe(false);
  });
  it("misses for another language", () => {
    expect(canReuseName(base, at(0), "en")).toBe(false);
  });
  it("misses for a blank cached name", () => {
    expect(canReuseName({ ...base, name: "  " }, at(0), "he")).toBe(false);
  });
  it("hits at the same point", () => {
    expect(canReuseName(base, at(0), "he")).toBe(true);
  });
  it("hits at the 300 m boundary and misses just past it", () => {
    expect(metersBetween(base, at(300 * perMeter))).toBeCloseTo(300, 3);
    expect(canReuseName(base, at(299 * perMeter), "he")).toBe(true);
    expect(canReuseName(base, at(301 * perMeter), "he")).toBe(false);
  });
  it("misses far away", () => {
    expect(canReuseName(base, at(0.5), "he")).toBe(false);
  });
});

describe("nameFromNominatim", () => {
  it("reads the real Jerusalem answer", () => {
    expect(nameFromNominatim(fixture("jerusalem"))).toBe("ירושלים");
  });
  it("reads the real Tel Aviv answer", () => {
    expect(nameFromNominatim(fixture("telaviv"))).toBe("תל־אביב–יפו");
  });
  it("reads a campus point as the town", () => {
    expect(nameFromNominatim(fixture("campus"))).toBe("רמת גן");
  });
  it("prefers city over town over village over municipality over hamlet", () => {
    expect(nameFromNominatim({ address: { hamlet: "h", municipality: "m", village: "v", town: "t", city: "c" } })).toBe("c");
    expect(nameFromNominatim({ address: { hamlet: "h", municipality: "m", village: "v", town: "t" } })).toBe("t");
    expect(nameFromNominatim({ address: { hamlet: "h", municipality: "m", village: "v" } })).toBe("v");
    expect(nameFromNominatim({ address: { hamlet: "h", municipality: "m" } })).toBe("m");
    expect(nameFromNominatim({ address: { hamlet: "h" } })).toBe("h");
  });
  it("skips blank names and trims", () => {
    expect(nameFromNominatim({ address: { city: "  ", town: " Lod " } })).toBe("Lod");
    expect(nameFromNominatim({ address: { city: "" } })).toBeNull();
  });
  it("is null for an error body, a missing address and a non-object", () => {
    expect(nameFromNominatim({ error: "Unable to geocode" })).toBeNull();
    expect(nameFromNominatim({})).toBeNull();
    expect(nameFromNominatim({ address: {} })).toBeNull();
    expect(nameFromNominatim(null)).toBeNull();
    expect(nameFromNominatim("x")).toBeNull();
    expect(nameFromNominatim({ address: { city: 5 } })).toBeNull();
  });
});

describe("nameFromDevice", () => {
  const addr = (o: { city?: string | null; subregion?: string | null; district?: string | null }) => ({ city: null, subregion: null, district: null, ...o });
  it("is null for no addresses", () => {
    expect(nameFromDevice([])).toBeNull();
  });
  it("prefers city, then subregion, then district", () => {
    expect(nameFromDevice([addr({ city: "A", subregion: "B", district: "C" })])).toBe("A");
    expect(nameFromDevice([addr({ subregion: "B", district: "C" })])).toBe("B");
    expect(nameFromDevice([addr({ district: "C" })])).toBe("C");
  });
  it("skips blank and whitespace values", () => {
    expect(nameFromDevice([addr({ city: " ", subregion: "", district: " D " })])).toBe("D");
  });
  it("looks at later addresses when the first has nothing", () => {
    expect(nameFromDevice([addr({}), addr({ city: "Z" })])).toBe("Z");
  });
  it("is null when nothing has a name", () => {
    expect(nameFromDevice([addr({}), addr({ city: "" })])).toBeNull();
  });
});

describe("parseCachedPlace", () => {
  it("is null for missing, corrupt and the old {lat, lon}-only shape", () => {
    expect(parseCachedPlace(null)).toBeNull();
    expect(parseCachedPlace("not json")).toBeNull();
    expect(parseCachedPlace(JSON.stringify({ lat: 1, lon: 2 }))).toBeNull();
    expect(parseCachedPlace(JSON.stringify({ lat: 1, lon: 2, name: "", lang: "he" }))).toBeNull();
    expect(parseCachedPlace(JSON.stringify({ lat: 1, lon: 2, name: "x", lang: "fr" }))).toBeNull();
  });
  it("reads a valid entry", () => {
    expect(parseCachedPlace(JSON.stringify({ lat: 1, lon: 2, name: "x", lang: "en" }))).toEqual({ lat: 1, lon: 2, name: "x", lang: "en" });
  });
});
