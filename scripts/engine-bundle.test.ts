import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/*
 * supabase/functions/_shared/engine.js is GENERATED from packages/engine by scripts/bundle-engine.sh and committed, so
 * deploys need no Node. It went stale once (2026-11-20: the server planned without the date no-repeat rule, the Yom
 * Kippur `unknown` shoe rule and the saved-outfit bonus for days after the engine had them). This test rebuilds it with
 * the project's own command into a temp file and fails when the committed copy differs: re-run the script and commit.
 */

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

describe("the committed engine bundle", () => {
  it("equals a fresh build of packages/engine (run scripts/bundle-engine.sh and commit if this fails)", () => {
    const dir = mkdtempSync(join(tmpdir(), "engine-bundle-"));
    try {
      const out = join(dir, "engine.js");
      execFileSync("bash", [join(root, "scripts/bundle-engine.sh"), out], { stdio: "pipe" });
      const fresh = readFileSync(out, "utf8");
      const committed = readFileSync(join(root, "supabase/functions/_shared/engine.js"), "utf8");
      // don't touch / compare the text, not a hash: when this fails the diff vitest prints says what drifted.
      expect(committed).toBe(fresh);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
