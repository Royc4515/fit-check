import type { ItemTags } from "@fit-check/schema";
import { describe, expect, it } from "vitest";
import { applyPatch, diffFields, enqueue, settle, shown, startNext, startQueue, type ItemFields } from "./editQueue";
import { ItemEditRunner, type ItemWriter } from "./editRunner";

const tags: ItemTags = {
  category: "top",
  subcategory: "polo",
  color_name: "white",
  color_hex: "#F5F5F0",
  secondary_color_hex: null,
  pattern: "solid",
  material: "cotton",
  sleeve: "short",
  fit: "regular",
  seasons: ["summer", "transition"],
  formality: 3,
  temp_min_c: 18,
  temp_max_c: 32,
  modesty_flags: ["short_sleeve"],
  style_tags: [],
};

const item: ItemFields = { name: "Polo", brand: "Benetton", notes: null, availability: "home", tags };

/** A write whose outcome the test decides later, in any order: the "slow failing write" a live preview cannot make. */
function controlledWriter() {
  const calls: { before: ItemFields; after: ItemFields; ok: () => Promise<void>; fail: () => Promise<void> }[] = [];
  const write: ItemWriter = (_id, before, after) =>
    new Promise<void>((resolve, reject) => {
      const flush = () => new Promise<void>((r) => setTimeout(r, 0));
      calls.push({
        before,
        after,
        ok: () => (resolve(), flush()),
        fail: () => (reject(new Error("write failed")), flush()),
      });
    });
  return { write, calls };
}

/** The wardrobe store's copy of the item, as the runner publishes it. */
function store() {
  const seen: ItemFields[] = [];
  return { publish: (_id: string, f: ItemFields) => void seen.push(f), last: () => seen[seen.length - 1] as ItemFields, seen };
}

const set = (patch: Partial<ItemFields>) => (cur: ItemFields) => ({ ...cur, ...patch });
const setTags = (patch: Partial<ItemTags>) => (cur: ItemFields) => ({ ...cur, tags: { ...cur.tags, ...patch } });

describe("editQueue (pure)", () => {
  it("diffs tags key by key and nothing when equal", () => {
    expect(diffFields(item, item)).toBeNull();
    expect(diffFields(item, { ...item, tags: { ...tags, pattern: "stripes" } })).toEqual({ tags: { pattern: "stripes" } });
    expect(diffFields(item, { ...item, tags: { ...tags, seasons: ["summer", "transition"] } })).toBeNull();
    expect(diffFields(item, { ...item, name: "Shirt", availability: "laundry" })).toEqual({ name: "Shirt", availability: "laundry" });
  });

  it("shows confirmed + pending in order; a later edit of a field wins", () => {
    let q = startQueue(item);
    q = enqueue(q, { id: 1, patch: { name: "A" } });
    q = enqueue(q, { id: 2, patch: { name: "B", tags: { pattern: "check" } } });
    expect(shown(q).name).toBe("B");
    expect(shown(q).tags.pattern).toBe("check");
    expect(shown(q).tags.color_name).toBe("white");
  });

  it("writes one edit at a time, over the confirmed state only", () => {
    let q = startQueue(item);
    q = enqueue(q, { id: 1, patch: { tags: { pattern: "stripes" } } });
    q = enqueue(q, { id: 2, patch: { name: "Renamed" } });
    const first = startNext(q);
    expect(first?.write.after).toEqual(applyPatch(item, { tags: { pattern: "stripes" } }));
    q = first!.queue;
    expect(startNext(q)).toBeNull(); // busy until the first settles
    q = settle(q, 1, false);
    const second = startNext(q);
    // The failed pattern is not in the second write.
    expect(second?.write.after).toEqual({ ...item, name: "Renamed" });
    expect(second?.write.before).toEqual(item);
  });

  it("a failure rolls back only the failed edit's fields, unless a later edit set them", () => {
    let q = startQueue(item);
    q = enqueue(q, { id: 1, patch: { name: "A", tags: { pattern: "stripes" } } });
    q = enqueue(q, { id: 2, patch: { name: "B" } });
    q = settle(startNext(q)!.queue, 1, false);
    expect(shown(q).name).toBe("B");
    expect(shown(q).tags.pattern).toBe("solid");
  });
});

describe("ItemEditRunner", () => {
  it("(a) availability: two quick picks, the first fails late: UI and server both end on the newer pick", async () => {
    const { write, calls } = controlledWriter();
    const runner = new ItemEditRunner(write);
    const s = store();
    const first = runner.submit("i", item, set({ availability: "laundry" }), s.publish);
    const second = runner.submit("i", item, set({ availability: "away" }), s.publish);
    first.catch(() => undefined);
    expect(s.last().availability).toBe("away");
    expect(calls).toHaveLength(1); // serialised: the second waits
    await calls[0]!.fail();
    expect(s.last().availability).toBe("away"); // not set back to "home"
    expect(calls).toHaveLength(2);
    expect(calls[1]!.before.availability).toBe("home");
    expect(calls[1]!.after.availability).toBe("away");
    await calls[1]!.ok();
    await expect(second).resolves.toBeUndefined();
    await expect(first).rejects.toThrow("write failed");
    expect(s.last().availability).toBe("away");
    expect(runner.pending("i")).toBe(0);
  });

  it("(b) two edits to different fields, the first fails: it is rolled back and never sent again", async () => {
    const { write, calls } = controlledWriter();
    const runner = new ItemEditRunner(write);
    const s = store();
    const pattern = runner.submit("i", item, setTags({ pattern: "stripes" }), s.publish);
    pattern.catch(() => undefined);
    const name = runner.submit("i", item, set({ name: "Benetton polo" }), s.publish);
    expect(s.last()).toMatchObject({ name: "Benetton polo", tags: { pattern: "stripes" } });
    await calls[0]!.fail();
    expect(s.last()).toMatchObject({ name: "Benetton polo", tags: { pattern: "solid" } });
    // The name write carries the confirmed pattern, not the failed one.
    expect(calls[1]!.after.tags.pattern).toBe("solid");
    expect(calls[1]!.after.name).toBe("Benetton polo");
    await calls[1]!.ok();
    await expect(name).resolves.toBeUndefined();
    expect(s.last()).toMatchObject({ name: "Benetton polo", tags: { pattern: "solid" } });
  });

  it("(c) two edits before a re-render (same stale item): a later failure does not undo the earlier success", async () => {
    const { write, calls } = controlledWriter();
    const runner = new ItemEditRunner(write);
    const s = store();
    // Both calls get the same render copy of the item, as two events before a re-render would.
    const a = runner.submit("i", item, set({ name: "First" }), s.publish);
    const b = runner.submit("i", item, setTags({ color_name: "navy", color_hex: "#1F2A44" }), s.publish);
    b.catch(() => undefined);
    // The second edit was applied to what was shown (the new name), not to the stale copy.
    expect(s.last()).toMatchObject({ name: "First", tags: { color_name: "navy" } });
    await calls[0]!.ok();
    await calls[1]!.fail();
    await expect(a).resolves.toBeUndefined();
    await expect(b).rejects.toThrow();
    expect(s.last()).toMatchObject({ name: "First", tags: { color_name: "white" } });
    expect(calls[1]!.after.name).toBe("First");
  });

  it("(d) the screen is gone when the write fails: the store is still rolled back", async () => {
    const { write, calls } = controlledWriter();
    const runner = new ItemEditRunner(write);
    const s = store();
    // Nobody keeps the promise (the screen unmounted); only the store's publish remains.
    void runner.submit("i", item, set({ notes: "dry clean" }), s.publish).catch(() => undefined);
    expect(s.last().notes).toBe("dry clean");
    await calls[0]!.fail();
    expect(s.last().notes).toBeNull();
    expect(runner.pending("i")).toBe(0);
  });

  it("two edits to the same field, the first fails late: the newer value stays and is the one written", async () => {
    const { write, calls } = controlledWriter();
    const runner = new ItemEditRunner(write);
    const s = store();
    const first = runner.submit("i", item, set({ name: "Older" }), s.publish);
    first.catch(() => undefined);
    const second = runner.submit("i", item, set({ name: "Newer" }), s.publish);
    expect(s.last().name).toBe("Newer");
    await calls[0]!.fail();
    expect(s.last().name).toBe("Newer");
    expect(calls[1]!.after.name).toBe("Newer");
    expect(calls[1]!.before.name).toBe("Polo");
    await calls[1]!.ok();
    await expect(second).resolves.toBeUndefined();
    expect(s.last().name).toBe("Newer");
  });

  it("three in a row, the middle one fails: only its field returns, the writes go in order", async () => {
    const { write, calls } = controlledWriter();
    const runner = new ItemEditRunner(write);
    const s = store();
    const one = runner.submit("i", item, set({ name: "One" }), s.publish);
    const two = runner.submit("i", item, setTags({ fit: "slim" }), s.publish);
    two.catch(() => undefined);
    const three = runner.submit("i", item, set({ availability: "laundry" }), s.publish);
    expect(s.last()).toMatchObject({ name: "One", availability: "laundry", tags: { fit: "slim" } });
    await calls[0]!.ok();
    await calls[1]!.fail();
    expect(s.last()).toMatchObject({ name: "One", availability: "laundry", tags: { fit: "regular" } });
    await calls[2]!.ok();
    await Promise.all([one, three]);
    expect(calls.map((c) => diffFields(c.before, c.after))).toEqual([{ name: "One" }, { tags: { fit: "slim" } }, { availability: "laundry" }]);
    // The third write was made over the confirmed name and without the failed fit.
    expect(calls[2]!.before).toMatchObject({ name: "One", tags: { fit: "regular" } });
    expect(s.last()).toMatchObject({ name: "One", availability: "laundry", tags: { fit: "regular" } });
  });

  it("a change that changes nothing makes no write", async () => {
    const { write, calls } = controlledWriter();
    const runner = new ItemEditRunner(write);
    const s = store();
    await runner.submit("i", item, set({ name: "Polo" }), s.publish);
    await runner.submit("i", item, () => null, s.publish);
    expect(calls).toHaveLength(0);
    expect(s.seen).toHaveLength(0);
  });

  it("edits of different items do not wait for each other", async () => {
    const { write, calls } = controlledWriter();
    const runner = new ItemEditRunner(write);
    const s = store();
    void runner.submit("a", item, set({ name: "A" }), s.publish);
    void runner.submit("b", item, set({ name: "B" }), s.publish);
    expect(calls).toHaveLength(2);
    await calls[0]!.ok();
    await calls[1]!.ok();
  });
});
