import type { SavedOutfitSignal } from "@fit-check/engine";
import { describe, expect, it } from "vitest";
import type { TodayRecord } from "../../data/feedback";
import { firstGeneration, initialLearn, learnedFrom, nextLearn, SAVED_LIST_GRACE_MS, skipCount } from "./learning";

const A: readonly SavedOutfitSignal[] = [{ itemIds: ["1", "2", "3"], isFavorite: false }];
const B: readonly SavedOutfitSignal[] = [...A, { itemIds: ["4", "5", "6"], isFavorite: true }];
const rec = (feedback: TodayRecord["feedback"], date = "2026-11-20"): TodayRecord => ({
  wearId: `${feedback}-${date}`,
  outfitId: "o",
  feedback,
  itemIds: ["1"],
  date,
});

describe("skipCount", () => {
  it("counts every answer that is not a wear, today and ahead", () => {
    expect(skipCount({ today: [rec("worn"), rec("skipped"), rec("disliked")], ahead: [rec("skipped", "2026-11-21"), rec("worn", "2026-11-21")] })).toBe(3);
    expect(skipCount({ today: [], ahead: [] })).toBe(0);
  });
});

describe("the saved outfits Today learns from", () => {
  const taps = {};

  it("opens with the list when it was already read, with none while it loads", () => {
    expect(learnedFrom(initialLearn(0, taps, A))).toBe(A);
    expect(learnedFrom(initialLearn(0, taps, null))).toEqual([]);
  });

  it("a list that arrives later changes nothing on screen: the same state, by identity", () => {
    const opened = initialLearn(0, taps, null);
    expect(nextLearn(opened, 0, taps, A)).toBe(opened);
    expect(nextLearn(opened, 0, taps, B)).toBe(opened);
  });

  it("a new skip takes in the latest list; an undo goes back to the list before it", () => {
    const opened = initialLearn(0, taps, null);
    const skipped = nextLearn(opened, 1, taps, A);
    expect(learnedFrom(skipped)).toBe(A);
    const undone = nextLearn(skipped, 0, taps, B);
    expect(learnedFrom(undone)).toEqual([]);
    const again = nextLearn(undone, 1, taps, B);
    expect(learnedFrom(again)).toBe(B);
  });

  it("a nudge takes in the latest list", () => {
    const opened = initialLearn(0, taps, null);
    const nudged = nextLearn(opened, 0, { "2026-11-20": { temp_steps: 1, formality_steps: 0 } }, A);
    expect(learnedFrom(nudged)).toBe(A);
  });

  it("a regeneration while the list is still not read keeps the list in force", () => {
    const opened = initialLearn(0, taps, A);
    expect(learnedFrom(nextLearn(opened, 1, taps, null))).toBe(A);
  });

  it("undoing a skip recorded before the screen opened takes the latest list", () => {
    const opened = initialLearn(2, taps, null);
    expect(learnedFrom(nextLearn(opened, 1, taps, A))).toBe(A);
  });
});

describe("the first generation and the saved list", () => {
  it("waits while the other inputs are not ready, whatever the list", () => {
    expect(firstGeneration({ othersReady: false, saved: "ready", waitedMs: 0 })).toBe("wait");
    expect(firstGeneration({ othersReady: false, saved: "error", waitedMs: 9999 })).toBe("wait");
  });

  it("goes with the list as soon as it has answered, without it as soon as it failed", () => {
    expect(firstGeneration({ othersReady: true, saved: "ready", waitedMs: 0 })).toBe("with");
    expect(firstGeneration({ othersReady: true, saved: "ready", waitedMs: 5000 })).toBe("with");
    expect(firstGeneration({ othersReady: true, saved: "error", waitedMs: 0 })).toBe("without");
  });

  it("waits for a loading list for the grace period only", () => {
    expect(firstGeneration({ othersReady: true, saved: "loading", waitedMs: 0 })).toBe("wait");
    expect(firstGeneration({ othersReady: true, saved: "loading", waitedMs: SAVED_LIST_GRACE_MS - 1 })).toBe("wait");
    expect(firstGeneration({ othersReady: true, saved: "loading", waitedMs: SAVED_LIST_GRACE_MS })).toBe("without");
  });
});
