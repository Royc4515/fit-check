import { garmentStore, r2ConfigFromEnv, type R2Config, type SupabaseBucket } from "./objects.ts";

const R2: R2Config = {
  accountId: "acct",
  bucket: "fit-check-cutouts",
  accessKeyId: "AKID",
  secretAccessKey: "SECRET",
  publicUrl: "https://pub-x.r2.dev",
};
const KEY = "u1/intake/1794182849065-0/1 a-cutout.png";
const bytes = (s: string) => new TextEncoder().encode(s);
const text = (b: Uint8Array | null) => (b === null ? null : new TextDecoder().decode(b));

function assertEquals(actual: unknown, expected: unknown) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

/** A Supabase bucket in memory, recording uploads. */
function fakeBucket(files: Record<string, string> = {}) {
  const uploads: { path: string; options: unknown }[] = [];
  const bucket: SupabaseBucket = {
    download: (path) =>
      Promise.resolve(path in files ? { data: new Blob([files[path]]), error: null } : { data: null, error: { message: "Object not found" } }),
    upload: (path, body, options) => {
      uploads.push({ path, options });
      files[path] = new TextDecoder().decode(body);
      return Promise.resolve({ error: null });
    },
    getPublicUrl: (path) => ({ data: { publicUrl: `https://ref.supabase.co/storage/v1/object/public/cutouts/${path}` } }),
  };
  return { bucket, uploads, files };
}

/** A fetch that answers from a map of R2 keys and records each request. */
function fakeR2(objects: Record<string, string>, opts: { failWrites?: boolean; status?: number } = {}) {
  const calls: { method: string; url: string; auth: string | null; cache: string | null }[] = [];
  const impl: typeof fetch = async (input) => {
    const req = input as Request;
    calls.push({ method: req.method, url: req.url, auth: req.headers.get("authorization"), cache: req.headers.get("cache-control") });
    const key = decodeURIComponent(new URL(req.url).pathname.replace(`/${R2.bucket}/`, ""));
    if (req.method === "PUT") {
      if (opts.failWrites) return new Response("no", { status: 500 });
      objects[key] = await req.text();
      return new Response(null, { status: 200 });
    }
    if (opts.status) return new Response("err", { status: opts.status });
    return key in objects ? new Response(objects[key]) : new Response("missing", { status: 404 });
  };
  return { impl, calls, objects };
}

Deno.test("reads from R2 when it has the key, signed, at the account endpoint", async () => {
  const r2 = fakeR2({ [KEY]: "from-r2" });
  const store = garmentStore(fakeBucket({ [KEY]: "from-supabase" }).bucket, R2, r2.impl);
  assertEquals(text(await store.read(KEY)), "from-r2");
  assertEquals(r2.calls[0].url, "https://acct.r2.cloudflarestorage.com/fit-check-cutouts/u1/intake/1794182849065-0/1%20a-cutout.png");
  assertEquals(r2.calls[0].auth?.startsWith("AWS4-HMAC-SHA256 Credential=AKID/"), true);
});

Deno.test("falls back to Supabase for a key only Supabase has (the app's own uploads)", async () => {
  const store = garmentStore(fakeBucket({ [KEY]: "from-supabase" }).bucket, R2, fakeR2({}).impl);
  assertEquals(text(await store.read(KEY)), "from-supabase");
});

Deno.test("falls back to Supabase when R2 errors, and answers null when neither has the key", async () => {
  const store = garmentStore(fakeBucket({ [KEY]: "from-supabase" }).bucket, R2, fakeR2({ [KEY]: "x" }, { status: 503 }).impl);
  assertEquals(text(await store.read(KEY)), "from-supabase");
  const empty = garmentStore(fakeBucket().bucket, R2, fakeR2({}).impl);
  assertEquals(await empty.read(KEY), null);
});

Deno.test("writes to R2 with a year-long immutable cache and does not touch Supabase", async () => {
  const sb = fakeBucket();
  const r2 = fakeR2({});
  const store = garmentStore(sb.bucket, R2, r2.impl);
  assertEquals(await store.write(KEY, bytes("png"), "image/png"), true);
  assertEquals(r2.objects[KEY], "png");
  assertEquals(r2.calls[0].cache, "public, max-age=31536000, immutable");
  assertEquals(sb.uploads.length, 0);
  assertEquals(store.publicUrl(KEY), "https://pub-x.r2.dev/u1/intake/1794182849065-0/1%20a-cutout.png");
});

Deno.test("a failed R2 write lands in Supabase instead, so the feature still works", async () => {
  const sb = fakeBucket();
  const store = garmentStore(sb.bucket, R2, fakeR2({}, { failWrites: true }).impl);
  assertEquals(await store.write(KEY, bytes("png"), "image/png"), true);
  assertEquals(sb.files[KEY], "png");
});

Deno.test("without R2 settings it is the Supabase bucket alone, as before", async () => {
  const sb = fakeBucket({ [KEY]: "from-supabase" });
  const r2 = fakeR2({ [KEY]: "from-r2" });
  const store = garmentStore(sb.bucket, null, r2.impl);
  assertEquals(text(await store.read(KEY)), "from-supabase");
  assertEquals(await store.write("u1/new.png", bytes("n"), "image/png"), true);
  assertEquals(sb.uploads[0], { path: "u1/new.png", options: { contentType: "image/png", upsert: true, cacheControl: "31536000" } });
  assertEquals(store.publicUrl("u1/new.png"), "https://ref.supabase.co/storage/v1/object/public/cutouts/u1/new.png");
  assertEquals(r2.calls.length, 0);
});

Deno.test("R2 settings count only when all five are present", () => {
  const full: Record<string, string> = {
    R2_ACCOUNT_ID: "acct",
    R2_BUCKET: "b",
    R2_ACCESS_KEY_ID: "k",
    R2_SECRET_ACCESS_KEY: "s",
    R2_PUBLIC_URL: "https://pub-x.r2.dev/",
  };
  assertEquals(r2ConfigFromEnv((n) => full[n])?.publicUrl, "https://pub-x.r2.dev");
  for (const missing of Object.keys(full)) {
    assertEquals(r2ConfigFromEnv((n) => (n === missing ? undefined : full[n])), null);
  }
});
