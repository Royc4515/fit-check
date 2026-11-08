/**
 * Seeds the real wardrobe (packages/engine/__fixtures__) into Supabase for ONE user, so the app has something
 * to show before the photo-intake flow exists.
 *
 * Usage:
 *   pnpm seed:wardrobe -- --user-id <uuid>            # dry run: validates and prints, touches nothing
 *   pnpm seed:wardrobe -- --user-id <uuid> --write    # writes (needs SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY)
 *   add --force to write even though the user already has items
 *
 * Get <uuid> after your first Google sign-in: Supabase dashboard > Authentication > Users.
 *
 * The service-role key bypasses RLS, so it lives only in your shell environment: never in a file, never in the app.
 *
 * Failure modes, all before any write: unknown user id, a user who already has items (the upsert would overwrite
 * tags you corrected in the app, hence --force), a fixture row that fails the tag schema. Re-running with --force
 * is an update keyed on (user_id, external_id), never a duplicate.
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ItemSchema, itemToInsertRow, orderPair, type Item } from "@fit-check/schema";

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const flag = (name: string) => args.includes(name);
const value = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

const userId = value("--user-id");
const write = flag("--write");
const force = flag("--force");
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function fail(message: string): never {
  console.error(`seed-wardrobe: ${message}`);
  process.exit(1);
}

if (!userId || !UUID.test(userId)) fail("pass --user-id <uuid> (Supabase dashboard > Authentication > Users)");

const wardrobe: Item[] = (JSON.parse(readFileSync(resolve(here, "../packages/engine/__fixtures__/wardrobe.json"), "utf8")) as unknown[]).map(
  (row, i) => {
    const parsed = ItemSchema.safeParse(row);
    if (!parsed.success) fail(`fixture row ${i} violates the item schema: ${parsed.error.message}`);
    return parsed.data;
  }
);
const pairs = JSON.parse(readFileSync(resolve(here, "../packages/engine/__fixtures__/pair-weights.json"), "utf8")) as Array<{
  item_a: string;
  item_b: string;
  weight: number;
}>;

const rows = wardrobe.map((item) => itemToInsertRow(item, userId));
const byCategory = rows.reduce<Record<string, number>>((acc, r) => ({ ...acc, [r.category]: (acc[r.category] ?? 0) + 1 }), {});
console.log(`items: ${rows.length}  by category: ${JSON.stringify(byCategory)}`);
console.log(`pair weights: ${pairs.length}`);

if (!write) {
  console.log("dry run: nothing written. Add --write to apply.");
  process.exit(0);
}

const url = process.env["SUPABASE_URL"];
const serviceKey = process.env["SUPABASE_SERVICE_ROLE_KEY"];
if (!url || !serviceKey) fail("set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in your shell to use --write");

const supabase = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

const user = await supabase.auth.admin.getUserById(userId);
if (user.error || !user.data.user) fail(`no auth user ${userId}: sign in with Google once first (${user.error?.message ?? "not found"})`);

const existing = await supabase.from("items").select("id", { count: "exact", head: true }).eq("user_id", userId);
if (existing.error) fail(`could not check existing items: ${existing.error.message}`);
if ((existing.count ?? 0) > 0 && !force) {
  fail(`user already has ${existing.count} items; re-seeding would overwrite tags edited in the app. Use --force to do it anyway.`);
}

const idByExternal = new Map<string, string>();
for (let i = 0; i < rows.length; i += 100) {
  const batch = rows.slice(i, i + 100);
  const res = await supabase.from("items").upsert(batch, { onConflict: "user_id,external_id" }).select("id,external_id");
  if (res.error) fail(`items upsert failed at batch ${i / 100}: ${res.error.message}`);
  for (const r of res.data) if (r.external_id) idByExternal.set(r.external_id, r.id);
}
console.log(`items written: ${idByExternal.size}`);

const pairRows = [];
const skipped: string[] = [];
for (const p of pairs) {
  const a = idByExternal.get(p.item_a);
  const b = idByExternal.get(p.item_b);
  if (!a || !b) {
    skipped.push(`${p.item_a}|${p.item_b}`);
    continue;
  }
  const [item_a, item_b] = orderPair(a, b);
  pairRows.push({ user_id: userId, item_a, item_b, weight: p.weight });
}
if (pairRows.length > 0) {
  const res = await supabase.from("pair_weights").upsert(pairRows, { onConflict: "user_id,item_a,item_b" });
  if (res.error) fail(`pair_weights upsert failed: ${res.error.message}`);
}
console.log(`pair weights written: ${pairRows.length}${skipped.length ? `  skipped (item not in fixture): ${skipped.join(", ")}` : ""}`);
