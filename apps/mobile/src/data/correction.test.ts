import { ItemSchema, type Item, type Subcategory } from "@fit-check/schema";
import { describe, expect, it } from "vitest";
import wardrobeJson from "../../../../packages/engine/__fixtures__/wardrobe.json";
import {
  CORRECTION_STEPS,
  DELETE_RETRY_STEPS,
  correctionFailure,
  keepHomeLaundry,
  laundryAfterCorrection,
  newestWorn,
  type DayLaundry,
} from "./correction";

const fixture: Item[] = (wardrobeJson as unknown[]).map((row) => ItemSchema.parse(row));
// One fixture item reshaped per kind: only the kind (for the wash rule), the id and the availability matter here.
const like = (sub: Subcategory, id: string): Item => ({ ...fixture[0]!, id, availability: "home", tags: { ...fixture[0]!.tags, subcategory: sub } });
// The verifier's case: flannel shirt (overshirt), jeans, polo; then a linen button-down; then trousers.
const flannel = like("overshirt", "flannel");
const jeans = like("jeans", "jeans");
const polo = like("polo", "polo");
const linen = like("button_down", "linen");
const trousers = like("trousers", "trousers");

/** A tiny world: where each garment is, and the moves applied to it in order. */
function world(laundry: string[]) {
  const where = new Map<string, "home" | "laundry">([flannel, jeans, polo, linen, trousers].map((i) => [i.id, laundry.includes(i.id) ? "laundry" : "home"]));
  const log: string[] = [];
  const at = (items: Item[]) => items.map((i) => ({ ...i, availability: where.get(i.id)! }));
  const apply = (home: string[], toLaundry: string[]) => {
    for (const id of home) {
      where.set(id, "home");
      log.push(`home ${id}`);
    }
    for (const id of toLaundry) {
      where.set(id, "laundry");
      log.push(`laundry ${id}`);
    }
  };
  return { where, log, at, apply };
}
// Every garment has been worn plenty since its wash (the stub build's 99): the rule sends each one at its first wear.
const counts = (items: Item[]) => new Map(items.map((i) => [i.id, 99]));

function correct(w: ReturnType<typeof world>, day: DayLaundry, earlier: Item[], corrected: Item[]) {
  const r = laundryAfterCorrection({ day, earlier: earlier.map((i) => i.id), corrected: w.at(corrected), counts: counts(corrected) });
  w.apply(r.home, r.laundry);
  return r;
}

describe("the laundry of a correction (DESIGN.md 5.1 item 1)", () => {
  const firstWear = { moved: ["flannel", "jeans", "polo"], keptHome: [] };

  it("correct once, then undo: everything this day moved goes home", () => {
    const w = world(firstWear.moved);
    const r = correct(w, firstWear, [flannel, jeans, polo], [flannel, jeans, linen]);
    expect(r.home).toEqual(["polo"]);
    expect(r.laundry).toEqual(["linen"]);
    // The status line names all of L, not only the garment just moved.
    expect(r.day.moved).toEqual(["flannel", "jeans", "linen"]);
    // Undo sends all of L home.
    w.apply(r.day.moved, []);
    expect(w.log).toEqual(["home polo", "laundry linen", "home flannel", "home jeans", "home linen"]);
    expect([...w.where.values()].every((v) => v === "home")).toBe(true);
  });

  it("correct twice in a row, then undo: the invariant holds after each step", () => {
    const w = world(firstWear.moved);
    const one = correct(w, firstWear, [flannel, jeans, polo], [flannel, jeans, linen]);
    const two = correct(w, one.day, [flannel, jeans, linen], [flannel, trousers, linen]);
    expect(two.home).toEqual(["jeans"]);
    expect(two.laundry).toEqual(["trousers"]);
    expect(two.day.moved).toEqual(["flannel", "linen", "trousers"]);
    w.apply(two.day.moved, []);
    expect(w.log).toEqual(["home polo", "laundry linen", "home jeans", "laundry trousers", "home flannel", "home linen", "home trousers"]);
    expect([...w.where.values()].every((v) => v === "home")).toBe(true);
  });

  it("a garment in the laundry before today's wear is not taken into L and not sent home", () => {
    const w = world(["trousers"]); // already in the wash from another day
    const r = correct(w, { moved: ["polo"], keptHome: [] }, [polo], [trousers]);
    expect(r.home).toEqual(["polo"]);
    expect(r.laundry).toEqual([]);
    expect(r.day.moved).toEqual([]);
  });

  it("a garment kept home today stays home and out of L, even when the corrected outfit holds it", () => {
    const day = keepHomeLaundry(firstWear, ["jeans"]);
    expect(day).toEqual({ moved: ["flannel", "polo"], keptHome: ["jeans"] });
    const w = world(day.moved);
    const r = correct(w, day, [flannel, jeans, polo], [flannel, jeans, linen]);
    expect(r.laundry).toEqual(["linen"]);
    expect(r.day.moved).toEqual(["flannel", "linen"]);
    expect(w.where.get("jeans")).toBe("home");
  });

  it("the earlier wear still counted when the counts are read is taken off, so a shared garment is not over-counted", () => {
    // A button-down goes after three wears. Two before today, one today (counted twice while both wears exist).
    const w = world([]);
    const r = laundryAfterCorrection({ day: { moved: [], keptHome: [] }, earlier: ["linen"], corrected: w.at([linen]), counts: new Map([["linen", 4]]) });
    expect(r.laundry).toEqual(["linen"]);
    const r2 = laundryAfterCorrection({ day: { moved: [], keptHome: [] }, earlier: ["linen"], corrected: w.at([linen]), counts: new Map([["linen", 3]]) });
    expect(r2.laundry).toEqual([]);
  });

  it("a planned day's wear (Shabbat, recorded on Friday) is corrected the same way: its list is the corrected outfit's", () => {
    // Laundry moves at press time for planned days too (DESIGN.md 4.1 item 6), so there is no separate pending list.
    const w = world(firstWear.moved);
    const r = correct(w, firstWear, [flannel, jeans, polo], [flannel, trousers, linen]);
    expect(new Set(r.day.moved)).toEqual(new Set(["flannel", "trousers", "linen"]));
    expect(r.day.moved.every((id) => ["flannel", "trousers", "linen"].includes(id))).toBe(true);
  });

  it("order: record, laundry, delete, unlearn; a retried delete never moves laundry again", () => {
    expect(CORRECTION_STEPS).toEqual(["record", "laundry", "delete", "unlearn"]);
    expect(DELETE_RETRY_STEPS).not.toContain("laundry");
  });
});

describe("failure lines and the record shown", () => {
  it("a failed record says nothing changed and retries the whole correction", () =>
    expect(correctionFailure("record")).toEqual({ messageKey: "today.status.correctionNotSaved", retries: "whole correction" }));
  it("a failed delete says the earlier record was kept and retries only the delete", () =>
    expect(correctionFailure("delete")).toEqual({ messageKey: "today.status.correctionOldKept", retries: "delete only" }));
  it("after a reload with two worn records the day shows the newest", () => {
    const records = [
      { id: "earlier", feedback: "worn" },
      { id: "skip", feedback: "skipped" },
      { id: "corrected", feedback: "worn" },
    ];
    expect(newestWorn(records)?.id).toBe("corrected");
    expect(newestWorn([{ id: "s", feedback: "skipped" }])).toBeNull();
  });
});
