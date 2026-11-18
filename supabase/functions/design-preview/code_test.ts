import { sameCode } from "./code.ts";

Deno.test("matches only the exact code", async () => {
  const code = "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6";
  if (!(await sameCode(code, code))) throw new Error("rejected the right code");
  for (const wrong of ["", code.slice(0, -1), `${code}0`, code.toUpperCase(), ` ${code}`]) {
    if (await sameCode(wrong, code)) throw new Error(`accepted ${JSON.stringify(wrong)}`);
  }
});

Deno.test("a missing secret never matches, not even an empty code", async () => {
  if (await sameCode("", "")) throw new Error("empty secret matched an empty code");
  if (await sameCode("anything", "")) throw new Error("empty secret matched");
});
