/**
 * A stand-in for the supabase-js query builder, for tests of the data layer's write paths: every request is recorded
 * (table, the write or read it is, its payload and its filters) and answered by the test's `respond`. Only what the
 * data layer calls is here. Test-only: never imported by app code.
 */

export type FakeCall = {
  table: string;
  /** insert | update | delete | upsert, or select when the request only reads. */
  op: string;
  payload: unknown;
  /** Filters and modifiers in call order, e.g. ["eq", "id", "o1"], ["is", "saved_at", null]. */
  filters: unknown[][];
};

export type FakeResponse = { data?: unknown; error?: unknown };

const WRITES = new Set(["insert", "update", "delete", "upsert"]);
const MODIFIERS = ["eq", "is", "not", "in", "gte", "lte", "order", "limit", "range", "single", "maybeSingle"];

/** A fake client and the calls it saw. `respond` gets each finished request and returns what it resolves to. */
export function fakeSupabase(respond: (call: FakeCall) => FakeResponse) {
  const calls: FakeCall[] = [];
  const from = (table: string) => {
    const call: FakeCall = { table, op: "", payload: undefined, filters: [] };
    calls.push(call);
    const builder: Record<string, unknown> = {};
    for (const op of [...WRITES, "select"]) {
      builder[op] = (...args: unknown[]) => {
        // `.insert(...).select("id")`: the select only shapes the answer; the request is still the insert.
        if (op === "select" && call.op !== "") call.filters.push(["select", ...args]);
        else {
          call.op = op;
          call.payload = args[0];
        }
        return builder;
      };
    }
    for (const m of MODIFIERS) {
      builder[m] = (...args: unknown[]) => {
        call.filters.push([m, ...args]);
        return builder;
      };
    }
    builder.then = (resolve: (r: FakeResponse) => unknown, reject: (e: unknown) => unknown) => {
      try {
        const r = respond(call);
        return Promise.resolve({ data: r.data ?? null, error: r.error ?? null }).then(resolve, reject);
      } catch (e) {
        return Promise.reject(e).then(resolve, reject);
      }
    };
    return builder;
  };
  return { client: { from }, calls };
}
