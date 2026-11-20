import { beforeEach, describe, expect, it, vi } from "vitest";
import { wornIndex, type WornIndex } from "../../data/savedOutfit";

// The tally slice of the shared store against a stubbed data layer: what is shown while the read runs, after it fails,
// and after a wear or an undo. The data layer itself is covered in data/outfits.test.ts.
const data = vi.hoisted(() => ({ tally: (): Promise<unknown> => Promise.resolve(null) }));
vi.mock("../../data/outfits", () => ({
  fetchSavedOutfit: vi.fn(),
  fetchSavedOutfits: vi.fn(() => Promise.resolve([])),
  fetchWornTally: vi.fn(() => data.tally()),
  removeSavedOutfit: vi.fn(),
  renameOutfit: vi.fn(),
  saveOutfit: vi.fn(),
  setOutfitFavorite: vi.fn(),
  updateSavedOutfit: vi.fn(),
}));

const { refreshTally, recordWornChange, tallyFor, tallyNow } = await import("./store");
const { fetchWornTally } = await import("../../data/outfits");

const SET = ["t1", "b1", "s1"];
const index = (...dates: string[]): WornIndex => wornIndex(dates.map((date) => ({ date, itemIds: SET })));
const serve = (...answers: (WornIndex | Error)[]) => {
  const queue = [...answers];
  data.tally = () => {
    const next = queue.length > 1 ? queue.shift()! : queue[0]!;
    return next instanceof Error ? Promise.reject(next) : Promise.resolve(next);
  };
};
const shown = (user: string) => tallyFor(tallyNow(user), SET);

let user = 0;
let u = "u0";
beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.mocked(fetchWornTally).mockClear();
  // A new user each test: the store forgets everything of the previous one.
  u = `u${++user}`;
});

describe("the tally slice", () => {
  it("starts loading with nothing to show: unknown, not zero", () => {
    expect(tallyNow(u)).toEqual({ status: "loading", index: null });
    expect(shown(u)).toBeNull();
  });

  it("a read answers ready, and the count is by set", async () => {
    serve(index("2026-11-02", "2026-11-09"));
    await refreshTally(u);
    expect(tallyNow(u).status).toBe("ready");
    expect(shown(u)).toEqual({ wornCount: 2, lastWornOn: "2026-11-09" });
    expect(tallyFor(tallyNow(u), ["t9", "b1", "s1"])).toEqual({ wornCount: 0, lastWornOn: null });
  });

  it("failing on the first load shows nothing (error, no index), and does not throw", async () => {
    serve(new Error("down"));
    await expect(refreshTally(u)).resolves.toBeUndefined();
    expect(tallyNow(u)).toEqual({ status: "error", index: null });
    expect(shown(u)).toBeNull();
  });

  it("good, then failing on a later read: the last good tally stays", async () => {
    serve(index("2026-11-02", "2026-11-09"), new Error("down"));
    await refreshTally(u);
    await refreshTally(u);
    expect(tallyNow(u).status).toBe("error");
    expect(shown(u)).toEqual({ wornCount: 2, lastWornOn: "2026-11-09" });
    // And it recovers on the next good read.
    serve(index("2026-11-02", "2026-11-09", "2026-11-12"));
    await refreshTally(u);
    expect(tallyNow(u).status).toBe("ready");
    expect(shown(u)).toEqual({ wornCount: 3, lastWornOn: "2026-11-12" });
  });

  it("another user never sees this user's tally", async () => {
    serve(index("2026-11-02"));
    await refreshTally(u);
    expect(tallyNow("someone-else")).toEqual({ status: "loading", index: null });
  });
});

describe("recordWornChange (after a wear or an undo)", () => {
  it("a wear moves the tally by set at once, then the refresh settles it", async () => {
    serve(index("2026-11-02"));
    await refreshTally(u);
    // The wear was recorded on an unsaved row of the same set: the id does not matter for the tally.
    let release: (i: WornIndex) => void = () => {};
    data.tally = () => new Promise((r) => (release = r as (i: WornIndex) => void));
    recordWornChange(u, { outfitId: "unsaved-row", itemIds: ["s1", "t1", "b1"], date: "2026-11-20" }, 1);
    expect(shown(u)).toEqual({ wornCount: 2, lastWornOn: "2026-11-20" });
    release(index("2026-11-02", "2026-11-20"));
    await vi.waitFor(() => expect(tallyNow(u).status).toBe("ready"));
    expect(vi.mocked(fetchWornTally)).toHaveBeenCalledTimes(2);
  });

  it("an undo lowers the count at once and the refresh corrects the date", async () => {
    serve(index("2026-11-02", "2026-11-20"));
    await refreshTally(u);
    serve(index("2026-11-02"));
    recordWornChange(u, { outfitId: "o1", itemIds: SET, date: "2026-11-20" }, -1);
    expect(shown(u)).toEqual({ wornCount: 1, lastWornOn: "2026-11-20" });
    await vi.waitFor(() => expect(shown(u)).toEqual({ wornCount: 1, lastWornOn: "2026-11-02" }));
  });

  it("with no tally ever read, nothing is read or shown: the next focus reads it", () => {
    serve(index("2026-11-02"));
    recordWornChange(u, { outfitId: "o1", itemIds: SET, date: "2026-11-20" }, 1);
    expect(vi.mocked(fetchWornTally)).not.toHaveBeenCalled();
    expect(shown(u)).toBeNull();
  });

  it("a read that started before the patch does not overwrite it", async () => {
    serve(index("2026-11-02"));
    await refreshTally(u);
    let release: (i: WornIndex) => void = () => {};
    data.tally = () => new Promise((r) => (release = r as (i: WornIndex) => void));
    const stale = refreshTally(u);
    const staleRelease = release;
    serve(index("2026-11-02", "2026-11-20"));
    recordWornChange(u, { outfitId: "o1", itemIds: SET, date: "2026-11-20" }, 1);
    staleRelease(index("2026-11-02"));
    await stale;
    await vi.waitFor(() => expect(shown(u)).toEqual({ wornCount: 2, lastWornOn: "2026-11-20" }));
  });
});
