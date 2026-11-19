import type { CandidateOutfit } from "@fit-check/schema";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeSupabase, type FakeCall, type FakeResponse } from "./__fixtures__/fakeSupabase";

// The write paths of recordFeedback and deleteFeedback against a recording stand-in for supabase-js: which requests
// go out, with which filters, and what is (not) cleaned up when one fails. The node runner has no react-native, so
// the client and the preview guard are replaced.
const state = vi.hoisted(() => ({ respond: (_: unknown): unknown => ({}), preview: false }));
let fake = fakeSupabase((c) => state.respond(c) as FakeResponse);
vi.mock("../lib/supabase", () => ({
  supabase: { from: (t: string) => fake.client.from(t) },
}));
vi.mock("./preview", () => ({
  isPreview: () => state.preview,
  getSnapshot: () => Promise.reject(new Error("no preview")),
  PreviewReadOnlyError: class PreviewReadOnlyError extends Error {},
}));

const { deleteFeedback, recordFeedback } = await import("./feedback");

const piece = (id: string, slot: "top" | "bottom" | "shoes") => ({ id, slot, name: id, subcategory: "tshirt" as const, color_name: "white" as const, formality: 3 });
const breakdown = { color_harmony: 0.5, formality_consistency: 0.5, context_fit: 1, recency_penalty: 0, pair_weight: 0 };
const outfit: CandidateOutfit = { outfit_id: "t1+b1+s1", items: [piece("t1", "top"), piece("b1", "bottom"), piece("s1", "shoes")], score: 0.71234, breakdown };

const base = { userId: "u1", date: "2026-11-19", dayType: "weekday" as const, outfit, source: "daily" as const, feedback: "worn" as const, adjustment: { temp_steps: 0, formality_steps: 0 } };

function use(respond: (c: FakeCall) => FakeResponse) {
  state.respond = (c) => respond(c as FakeCall);
  fake = fakeSupabase((c) => state.respond(c) as FakeResponse);
}

beforeEach(() => {
  state.preview = false;
});

describe("recordFeedback", () => {
  it("without a saved outfit writes outfits, outfit_items and wears as before", async () => {
    use((c) => (c.op === "insert" && c.table === "outfits" ? { data: { id: "o9" } } : c.table === "wears" ? { data: { id: "w9" } } : {}));
    const record = await recordFeedback(base);
    expect(fake.calls.map((c) => `${c.op} ${c.table}`)).toEqual(["insert outfits", "insert outfit_items", "insert wears"]);
    expect(fake.calls[0]!.payload).toEqual({ user_id: "u1", context_type: "weekday", created_for_date: "2026-11-19", score: 0.712, breakdown: { ...breakdown, adjustment: { temp_steps: 0, formality_steps: 0 } }, source: "daily" });
    expect(record).toEqual({ wearId: "w9", outfitId: "o9", feedback: "worn", itemIds: ["t1", "b1", "s1"], date: "2026-11-19" });
  });

  it("without a saved outfit still deletes the new outfit when the wear insert fails", async () => {
    use((c) => (c.op === "insert" && c.table === "outfits" ? { data: { id: "o9" } } : c.table === "wears" ? { error: new Error("boom") } : {}));
    await expect(recordFeedback(base)).rejects.toThrow("boom");
    expect(fake.calls.map((c) => `${c.op} ${c.table}`)).toEqual(["insert outfits", "insert outfit_items", "insert wears", "delete outfits"]);
    expect(fake.calls[3]!.filters).toEqual([["eq", "id", "o9"]]);
  });

  it("on a saved outfit inserts only the wear, pointing at it", async () => {
    use((c) => (c.table === "wears" ? { data: { id: "w1" } } : {}));
    const record = await recordFeedback({ ...base, savedOutfitId: "saved1" });
    expect(fake.calls.map((c) => `${c.op} ${c.table}`)).toEqual(["insert wears"]);
    expect(fake.calls[0]!.payload).toEqual({ user_id: "u1", outfit_id: "saved1", worn_on: "2026-11-19", feedback: "worn" });
    expect(record).toEqual({ wearId: "w1", outfitId: "saved1", feedback: "worn", itemIds: ["t1", "b1", "s1"], date: "2026-11-19" });
  });

  it("on a saved outfit deletes nothing when the wear insert fails", async () => {
    use(() => ({ error: new Error("boom") }));
    await expect(recordFeedback({ ...base, savedOutfitId: "saved1" })).rejects.toThrow("boom");
    expect(fake.calls.map((c) => `${c.op} ${c.table}`)).toEqual(["insert wears"]);
  });

  it("rejects in the design preview before any request", async () => {
    state.preview = true;
    use(() => ({}));
    await expect(recordFeedback({ ...base, savedOutfitId: "saved1" })).rejects.toThrow();
    expect(fake.calls).toEqual([]);
  });
});

describe("deleteFeedback (undo)", () => {
  const record = { wearId: "w1", outfitId: "o1", feedback: "worn" as const, itemIds: ["t1", "b1", "s1"], date: "2026-11-19" };

  it("deletes the wear and then a one-off suggestion, guarded on saved_at is null", async () => {
    use((c) => (c.op === "select" ? { data: { saved_at: null, wears: [] } } : {}));
    await deleteFeedback(record);
    expect(fake.calls.map((c) => `${c.op} ${c.table}`)).toEqual(["delete wears", "select outfits", "delete outfits"]);
    expect(fake.calls[2]!.filters).toEqual([
      ["eq", "id", "o1"],
      ["is", "saved_at", null],
    ]);
  });

  it("keeps a saved outfit: only the wear is deleted", async () => {
    use((c) => (c.op === "select" ? { data: { saved_at: "2026-11-19T08:00:00Z", wears: [] } } : {}));
    await deleteFeedback(record);
    expect(fake.calls.map((c) => `${c.op} ${c.table}`)).toEqual(["delete wears", "select outfits"]);
  });

  it("keeps an outfit other wears still point at", async () => {
    use((c) => (c.op === "select" ? { data: { saved_at: null, wears: [{ id: "w0" }] } } : {}));
    await deleteFeedback(record);
    expect(fake.calls.map((c) => `${c.op} ${c.table}`)).toEqual(["delete wears", "select outfits"]);
  });

  it("stops when the wear delete fails, touching no outfit", async () => {
    use(() => ({ error: new Error("boom") }));
    await expect(deleteFeedback(record)).rejects.toThrow("boom");
    expect(fake.calls.map((c) => `${c.op} ${c.table}`)).toEqual(["delete wears"]);
  });
});
