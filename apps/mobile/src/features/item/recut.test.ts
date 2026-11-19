import { describe, expect, it } from "vitest";
import { recutReplacesImproved } from "./recut";

const dir = "u1/intake/1731830000000-mcp";

describe("recutReplacesImproved", () => {
  it("is true for an AI redraw, before and after its background was removed", () => {
    expect(recutReplacesImproved(`${dir}/3-enhanced-1731830123456.png`)).toBe(true);
    expect(recutReplacesImproved(`${dir}/3-enhanced-1731830123456-cutout.png`)).toBe(true);
    expect(recutReplacesImproved(`${dir}/3-enhanced.png`)).toBe(true);
    expect(recutReplacesImproved(`${dir}/3-enhanced-cutout.png`)).toBe(true);
  });

  it("is true for a picture cleaned by hand", () => {
    expect(recutReplacesImproved(`${dir}/12-clean-1731850000000-cutout.png`)).toBe(true);
  });

  it("is false for a plain cutout of the original photo, a re-cut of it, the crop itself, or no picture", () => {
    expect(recutReplacesImproved(`${dir}/3-cutout.png`)).toBe(false);
    expect(recutReplacesImproved(`${dir}/3-recut-1731830123456-cutout.png`)).toBe(false);
    expect(recutReplacesImproved(`${dir}/3.jpg`)).toBe(false);
    expect(recutReplacesImproved(null)).toBe(false);
  });

  it("looks at the file name only, not at folder names", () => {
    expect(recutReplacesImproved("u1/clean-enhanced/3-cutout.png")).toBe(false);
  });
});
