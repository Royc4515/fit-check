import { describe, expect, it } from "vitest";
import { announceWears, laundryNow, onOtherWears, setLaundry, subscribeLaundry } from "./feedbackSync";

describe("feedbackSync", () => {
  it("tells every other hook about a wear write, never the writer itself", () => {
    const today = Symbol("today");
    const outfit = Symbol("outfit");
    const heard: string[] = [];
    const offToday = onOtherWears(today, () => heard.push("today"));
    const offOutfit = onOtherWears(outfit, () => heard.push("outfit"));
    announceWears(outfit);
    expect(heard).toEqual(["today"]);
    announceWears(today);
    expect(heard).toEqual(["today", "outfit"]);
    offToday();
    announceWears(outfit);
    expect(heard).toEqual(["today", "outfit"]);
    offOutfit();
  });

  it("keeps one laundry state for the app: a wear made on one screen is undone with its laundry on another", () => {
    let calls = 0;
    const off = subscribeLaundry(() => calls++);
    setLaundry(() => ({ wearId: "w1", itemIds: ["polo"], keptHome: [] }), "2026-11-20");
    const after = laundryNow();
    expect(after).toEqual({ laundered: { wearId: "w1", itemIds: ["polo"], keptHome: [] }, date: "2026-11-20" });
    // The snapshot is the same object until something changes (useSyncExternalStore needs that).
    expect(laundryNow()).toBe(after);
    setLaundry((cur) => cur);
    expect(calls).toBe(1);
    // The date stays when a change does not give one (keep out of the laundry).
    setLaundry((cur) => (cur ? { ...cur, itemIds: [], keptHome: ["polo"] } : cur));
    expect(laundryNow().date).toBe("2026-11-20");
    setLaundry(() => null);
    expect(laundryNow().laundered).toBeNull();
    expect(calls).toBe(3);
    off();
  });
});
