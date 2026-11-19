import type { SupabaseClient } from "@supabase/supabase-js";
import { contextClear, contextGet, contextSet, loadObservesShabbat } from "./context.ts";
import { israelDate } from "./time.ts";
import type { ToolContext, ToolResult } from "./tools.ts";

/**
 * In-memory stand-in for the slice of the Supabase client context.ts uses (from / select / eq / in / order / upsert /
 * delete / maybeSingle). It exists to check ORDER and FAILURE behaviour of context_set, which a real database would
 * hide. `failDeletes` makes the next N delete statements fail.
 */
type Row = Record<string, unknown>;
class Fake {
  contexts: Row[] = [];
  profile: Row[] = [];
  failDeletes = 0;
  statements: string[] = [];
  from(table: string) {
    return new Query(this, table);
  }
}
class Query {
  private op: "select" | "delete" | "upsert" = "select";
  private filters: Array<(r: Row) => boolean> = [];
  private payload: Row = {};
  private single = false;
  constructor(private db: Fake, private table: string) {}
  private rows() {
    return (this.table === "contexts" ? this.db.contexts : this.db.profile);
  }
  select(_cols?: string) {
    return this;
  }
  eq(col: string, v: unknown) {
    this.filters.push((r) => r[col] === v);
    return this;
  }
  in(col: string, vs: unknown[]) {
    this.filters.push((r) => vs.includes(r[col]));
    return this;
  }
  order(_c: string, _o?: unknown) {
    return this;
  }
  maybeSingle() {
    this.single = true;
    return this;
  }
  upsert(row: Row, _opts?: unknown) {
    this.op = "upsert";
    this.payload = row;
    return this;
  }
  delete() {
    this.op = "delete";
    return this;
  }
  // Thenable on purpose: supabase-js builders are awaited without a terminal call.
  then(res: (v: { data: Row[] | Row | null; error: { message: string } | null }) => unknown, rej?: (e: unknown) => unknown) {
    return Promise.resolve(this.exec()).then(res, rej);
  }
  private exec() {
    const rows = this.rows();
    this.db.statements.push(`${this.op} ${this.table}`);
    if (this.op === "upsert") {
      const p = this.payload;
      const hit = rows.find((r) => r.user_id === p.user_id && r.date === p.date && r.type === p.type);
      if (hit) Object.assign(hit, p);
      else rows.push({ id: crypto.randomUUID(), context_key: null, ...p });
      return { data: null, error: null };
    }
    if (this.op === "delete") {
      if (this.db.failDeletes > 0) {
        this.db.failDeletes--;
        return { data: null, error: { message: "boom" } };
      }
      const gone = rows.filter((r) => this.filters.every((f) => f(r)));
      for (const g of gone) rows.splice(rows.indexOf(g), 1);
      return { data: gone, error: null };
    }
    const found = rows.filter((r) => this.filters.every((f) => f(r))).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
    return { data: this.single ? found[0] ?? null : found, error: null };
  }
}

const USER = "00000000-0000-4000-8000-000000000001";
const OTHER = "00000000-0000-4000-8000-000000000002";
function setup() {
  const db = new Fake();
  const ctx: ToolContext = { db: db as unknown as SupabaseClient, userId: USER, supabaseUrl: "https://x.supabase.co" };
  return { db, ctx };
}
const body = (r: ToolResult) => JSON.parse((r.content[0] as { text: string }).text);
const today = israelDate();
const row = (type: string, over: Row = {}): Row => ({ id: crypto.randomUUID(), user_id: USER, date: today, type, source: "calendar", payload: {}, context_key: null, created_at: "2026-01-01T00:00:00.000Z", ...over });
const types = (db: Fake) => db.contexts.filter((r) => r.user_id === USER && r.date === today).map((r) => r.type).sort();
const assert = (cond: unknown, msg: string) => {
  if (!cond) throw new Error(msg);
};

Deno.test("context_set with no existing row stores one row and describes the rules", async () => {
  const { db, ctx } = setup();
  const r = await contextSet({ type: "interview", label: "job interview" }, ctx);
  assert(!r.isError, "should succeed");
  assert(JSON.stringify(types(db)) === '["interview"]', "one interview row");
  assert(db.contexts[0]?.source === "calendar", "source defaults to calendar");
  assert(db.contexts[0]?.context_key === null, "context_key stays null");
  assert(body(r).effect.includes("interview rules"), "effect names the rule set");
});

Deno.test("a date row exists and interview is set: exactly one row remains, the interview", async () => {
  const { db, ctx } = setup();
  db.contexts.push(row("date"));
  await contextSet({ type: "interview" }, ctx);
  assert(JSON.stringify(types(db)) === '["interview"]', `got ${types(db)}`);
});

Deno.test("the same type twice is one row with the new label", async () => {
  const { db, ctx } = setup();
  await contextSet({ type: "event", label: "first" }, ctx);
  await contextSet({ type: "event", label: "second" }, ctx);
  assert(db.contexts.length === 1, "one row");
  assert((db.contexts[0]?.payload as Row).label === "second", "label replaced");
});

Deno.test("re-setting without a label drops the old label but keeps other payload keys", async () => {
  const { db, ctx } = setup();
  db.contexts.push(row("interview", { payload: { label: "old", company: "tech" } }));
  await contextSet({ type: "interview" }, ctx);
  const p = db.contexts[0]?.payload as Row;
  assert(p.label === undefined && p.company === "tech", JSON.stringify(p));
});

Deno.test("when the delete fails after the upsert, the new row exists, the old one remains (two rows, never none), and the call says so", async () => {
  const { db, ctx } = setup();
  db.contexts.push(row("date"));
  db.failDeletes = 2; // the single retry fails too
  const r = await contextSet({ type: "interview" }, ctx);
  assert(r.isError && body(r).error.code === "stored_but_cleanup_failed", "typed cleanup error");
  assert(JSON.stringify(types(db)) === '["date","interview"]', `got ${types(db)}`);
  const newest = (await contextGet({}, ctx)).content[0] as { text: string };
  assert(JSON.parse(newest.text).context.type === "interview", "readers take the newest row");
  // a retry finishes the job
  await contextSet({ type: "interview" }, ctx);
  assert(JSON.stringify(types(db)) === '["interview"]', "retry cleans up");
});

Deno.test("one failed delete is retried once and succeeds", async () => {
  const { db, ctx } = setup();
  db.contexts.push(row("date"));
  db.failDeletes = 1;
  const r = await contextSet({ type: "event" }, ctx);
  assert(!r.isError && JSON.stringify(types(db)) === '["event"]', "retry worked");
});

Deno.test("shabbat, holiday, weekday, reserve and trip rows, and other users' rows, are never touched", async () => {
  const { db, ctx } = setup();
  for (const t of ["shabbat", "holiday", "weekday", "reserve", "trip"]) db.contexts.push(row(t));
  db.contexts.push(row("date", { user_id: OTHER }));
  await contextSet({ type: "interview" }, ctx);
  assert(JSON.stringify(types(db)) === '["holiday","interview","reserve","shabbat","trip","weekday"]', `got ${types(db)}`);
  assert(db.contexts.some((r) => r.user_id === OTHER && r.type === "date"), "other user's row kept");
  await contextClear({}, ctx);
  assert(JSON.stringify(types(db)) === '["holiday","reserve","shabbat","trip","weekday"]', "clear removes only the occasion");
});

Deno.test("a calendar write over a hand-set context is refused; a manual write is allowed", async () => {
  const { db, ctx } = setup();
  db.contexts.push(row("date", { source: "manual", payload: { label: "evening out" } }));
  const refused = await contextSet({ type: "interview" }, ctx);
  assert(refused.isError && body(refused).error.code === "manual_context_exists", "refused");
  assert(JSON.stringify(types(db)) === '["date"]', "nothing changed");
  const allowed = await contextSet({ type: "interview", source: "manual" }, ctx);
  assert(!allowed.isError && JSON.stringify(types(db)) === '["interview"]', "manual replaces");
});

Deno.test("dates outside the window, impossible dates, names and wrong types are typed errors and write nothing", async () => {
  const { db, ctx } = setup();
  const far = new Date(Date.now() + 40 * 86_400_000).toISOString().slice(0, 10);
  const old = new Date(Date.now() - 5 * 86_400_000).toISOString().slice(0, 10);
  const cases: Array<[unknown, string]> = [
    [{ type: "interview", date: far }, "date_out_of_range"],
    [{ type: "interview", date: old }, "date_out_of_range"],
    [{ type: "interview", date: "2026-02-30" }, "invalid_input"],
    [{ type: "shabbat" }, "invalid_input"],
    [{ type: "date", name: "Dana" }, "invalid_input"],
    [{ type: "date", context_key: "Dana" }, "invalid_input"],
    [{ type: "date", label: "a\nb" }, "invalid_input"],
    [{ type: "date", label: "x".repeat(61) }, "invalid_input"],
  ];
  for (const [args, code] of cases) {
    const r = await contextSet(args, ctx);
    assert(r.isError && body(r).error.code === code, `${JSON.stringify(args)} -> ${r.content[0] && (r.content[0] as { text: string }).text}`);
  }
  assert(db.contexts.length === 0 && db.statements.length === 0, "no database access for rejected input");
});

Deno.test("context_get: none, a context, and the profile setting (missing row = true)", async () => {
  const { db, ctx } = setup();
  let g = body(await contextGet({}, ctx));
  assert(g.context === "none" && g.observes_shabbat === true, JSON.stringify(g));
  db.contexts.push(row("event", { source: "manual", payload: { label: "wedding" } }));
  db.profile.push({ user_id: USER, observes_shabbat: false });
  g = body(await contextGet({}, ctx));
  assert(g.context.type === "event" && g.context.label === "wedding" && g.context.source === "manual" && g.observes_shabbat === false, JSON.stringify(g));
  db.profile[0] = { user_id: USER, observes_shabbat: null };
  assert((await loadObservesShabbat(ctx)) === true, "null means true");
});

Deno.test("context_clear succeeds quietly when there is nothing", async () => {
  const { ctx } = setup();
  const r = await contextClear({}, ctx);
  assert(!r.isError && Array.isArray(body(r).cleared) && body(r).cleared.length === 0, "quiet success");
});
