import { describe, expect, it } from "vitest";
import { dollars, meterLevel } from "./meter";

describe("meterLevel", () => {
  it("ok below 80, near from 80, over at 100; unknown is ok", () => {
    expect(meterLevel({ percent: 79 })).toBe("ok");
    expect(meterLevel({ percent: 80 })).toBe("near");
    expect(meterLevel({ percent: 100 })).toBe("over");
    expect(meterLevel({ percent: null })).toBe("ok");
    expect(meterLevel(null)).toBe("ok");
  });
});

describe("dollars", () => {
  it("two decimals, and a fraction of a cent reads as a cent, not zero", () => {
    expect(dollars(0.5)).toBe("$0.50");
    expect(dollars(0.123)).toBe("$0.12");
    expect(dollars(0.001)).toBe("$0.01");
    expect(dollars(0)).toBe("$0.00");
  });
});
