import { describe, expect, it } from "vitest";
import { CARD_MIN_WIDTH, fitFlatLay, HERO_CLEARANCE, HERO_MIN } from "./flatLayFit";

const base = { measured: true, desktop: false, width: 390, viewportHeight: 788, heroTop: 200, bottomReserved: 0 };

describe("fitFlatLay: the flat-lay fits above the bar or the bottom edge", () => {
  it("caps a phone's full-bleed surface to the space left, minus the clearance", () => {
    expect(fitFlatLay(base)).toEqual({ maxHeight: 788 - 200 - HERO_CLEARANCE, cardWidth: null, card: false });
  });

  it("subtracts a floating bar", () => {
    expect(fitFlatLay({ ...base, bottomReserved: 120 }).maxHeight).toBe(788 - 120 - 200 - HERO_CLEARANCE);
  });

  it("never goes under the floor; the page scrolls instead", () => {
    expect(fitFlatLay({ ...base, heroTop: 700 }).maxHeight).toBe(HERO_MIN * 1.25);
  });

  it("caps nothing until measured", () => {
    expect(fitFlatLay({ ...base, measured: false })).toEqual({ maxHeight: undefined, cardWidth: null, card: false });
    expect(fitFlatLay({ ...base, measured: false, width: CARD_MIN_WIDTH })).toEqual({ maxHeight: undefined, cardWidth: null, card: true });
  });

  it("makes a centred card from 600 to 899, no wider than the content column", () => {
    const fit = fitFlatLay({ ...base, width: 700, viewportHeight: 900, heroTop: 300 });
    expect(fit.card).toBe(true);
    expect(fit.maxHeight).toBeUndefined();
    expect(fit.cardWidth).toBeCloseTo((900 - 300 - HERO_CLEARANCE) / 1.25);
    expect(fitFlatLay({ ...base, width: 700, viewportHeight: 2000 }).cardWidth).toBe(560);
    expect(fitFlatLay({ ...base, width: 700, viewportHeight: 400 }).cardWidth).toBe(HERO_MIN);
  });

  it("leaves the desktop layout alone", () => {
    expect(fitFlatLay({ ...base, desktop: true, width: 1280 })).toEqual({ maxHeight: undefined, cardWidth: null, card: false });
  });
});
