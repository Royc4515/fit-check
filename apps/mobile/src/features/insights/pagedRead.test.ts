import { describe, expect, it } from "vitest";
import { MAX_PAGES, PAGE_SIZE, readAllPages } from "./pagedRead";

/** A table of `n` rows read through a fake `.range()`, recording every range asked for. */
function table(n: number, failAtCall?: number) {
  const ranges: [number, number][] = [];
  const fetchPage = async (from: number, to: number) => {
    ranges.push([from, to]);
    if (failAtCall !== undefined && ranges.length === failAtCall) throw new Error("network down");
    return Array.from({ length: Math.max(0, Math.min(n, to + 1) - from) }, (_, k) => from + k);
  };
  return { fetchPage, ranges };
}

describe("readAllPages", () => {
  it("an empty table is one request, no rows, not partial", async () => {
    const t = table(0);
    expect(await readAllPages(t.fetchPage, 10)).toEqual({ rows: [], partial: false });
    expect(t.ranges).toEqual([[0, 9]]);
  });

  it("fewer rows than a page is one request", async () => {
    const t = table(4);
    const got = await readAllPages(t.fetchPage, 10);
    expect(got).toEqual({ rows: [0, 1, 2, 3], partial: false });
    expect(t.ranges).toHaveLength(1);
  });

  it("exactly one full page asks once more, because a full page may have more behind it", async () => {
    const t = table(10);
    const got = await readAllPages(t.fetchPage, 10);
    expect(got.rows).toHaveLength(10);
    expect(got.partial).toBe(false);
    expect(t.ranges).toEqual([
      [0, 9],
      [10, 19],
    ]);
  });

  it("a short last page ends the read, with every row once and in order", async () => {
    const t = table(25);
    const got = await readAllPages(t.fetchPage, 10);
    expect(got.rows).toEqual(Array.from({ length: 25 }, (_, k) => k));
    expect(got.partial).toBe(false);
    expect(t.ranges).toEqual([
      [0, 9],
      [10, 19],
      [20, 29],
    ]);
  });

  it("an error on a later page rejects with that error, and no partial result is returned", async () => {
    const t = table(35, 2);
    await expect(readAllPages(t.fetchPage, 10)).rejects.toThrow("network down");
    expect(t.ranges).toHaveLength(2);
  });

  it("an error on the first page rejects too", async () => {
    const t = table(5, 1);
    await expect(readAllPages(t.fetchPage, 10)).rejects.toThrow("network down");
  });

  it("stops at the page cap and says the total is partial", async () => {
    const t = table(1000);
    const got = await readAllPages(t.fetchPage, 10, 3);
    expect(got.rows).toHaveLength(30);
    expect(got.partial).toBe(true);
    expect(t.ranges).toHaveLength(3);
  });

  it("a table of exactly the cap is reported partial too (the pager cannot tell without one more read)", async () => {
    const t = table(30);
    const got = await readAllPages(t.fetchPage, 10, 3);
    expect(got.partial).toBe(true);
    expect(got.rows).toHaveLength(30);
  });

  it("just under the cap is complete", async () => {
    const t = table(29);
    expect((await readAllPages(t.fetchPage, 10, 3)).partial).toBe(false);
  });

  it("uses PostgREST's page size and a 20,000 row cap by default", async () => {
    expect(PAGE_SIZE).toBe(1000);
    expect(MAX_PAGES * PAGE_SIZE).toBe(20_000);
    const t = table(2500);
    const got = await readAllPages(t.fetchPage);
    expect(got.rows).toHaveLength(2500);
    expect(t.ranges).toEqual([
      [0, 999],
      [1000, 1999],
      [2000, 2999],
    ]);
  });

  it("a page size of one still pages correctly", async () => {
    const t = table(3);
    expect((await readAllPages(t.fetchPage, 1)).rows).toEqual([0, 1, 2]);
  });
});
