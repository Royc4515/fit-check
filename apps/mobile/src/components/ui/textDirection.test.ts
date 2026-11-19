import { describe, expect, it } from "vitest";
import { textDirection } from "./textDirection";

describe("textDirection", () => {
  it("follows the script of a plain string", () => {
    expect(textDirection("Carhartt WIP", "rtl")).toBe("ltr");
    expect(textDirection("גבעת שמואל", "ltr")).toBe("rtl");
  });
  it("lets a long Latin name win over a short Hebrew type word, so its start survives truncation", () => {
    expect(textDirection("חולצה · Carhartt WIP Detroit Jacket", "rtl")).toBe("ltr");
  });
  it("keeps a Hebrew sentence with one Latin word right-to-left", () => {
    expect(textDirection("המיקום שלי (GPS)", "ltr")).toBe("rtl");
  });
  it("breaks a tie by the first strong character", () => {
    expect(textDirection("אב ab", "ltr")).toBe("rtl");
    expect(textDirection("ab אב", "rtl")).toBe("ltr");
  });
  it("draws digits left-to-right and uses the fallback for no letters or digits", () => {
    expect(textDirection("18:30", "rtl")).toBe("ltr");
    expect(textDirection("·", "rtl")).toBe("rtl");
    expect(textDirection("", "ltr")).toBe("ltr");
  });
});
