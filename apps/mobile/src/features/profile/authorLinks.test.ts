import { describe, expect, it } from "vitest";
import en from "../../../locales/en.json";
import he from "../../../locales/he.json";
import { AUTHOR_LINKS } from "./authorLinks";

describe("AUTHOR_LINKS", () => {
  it("holds exactly the three addresses Roy gave, over https", () => {
    expect(AUTHOR_LINKS.map((l) => l.href)).toEqual([
      "https://roy-carmelli-portfolio.vercel.app/",
      "https://www.linkedin.com/in/roy-carmelli",
      "https://github.com/Royc4515",
    ]);
  });

  it("has a label in both locales for every link", () => {
    for (const { key } of AUTHOR_LINKS) {
      expect(he.credits[key]).toBeTruthy();
      expect(en.credits[key]).toBeTruthy();
    }
  });
});
