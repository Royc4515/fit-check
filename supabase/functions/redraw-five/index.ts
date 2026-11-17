// TEMPORARY (2026-11-17, Roy approved): paid redraw of 5 named items whose free cutout still shows a garment behind.
// The descriptions are written by Claude from the photos, so one call per item is enough. One-time code; retire to 410.
import { createClient } from "@supabase/supabase-js";
import { cutout } from "../_shared/ai/modal.ts";
import { sniffImageType } from "../_shared/media.ts";

const CODE = "d76993f902507cda82b7cfe575504206ad2b576879db55f8";
const EXPIRES = Date.parse("2026-11-19T00:00:00Z");
const OWNER = "f797bc43-e210-4f93-891d-a7616643a0d8";
const MODEL = "gemini-3.1-flash-lite-image";
const PRICE = { input_token: 0.25 / 1_000_000, image: 0.0336 };
const BUDGET = 8;

const b64 = (bytes: Uint8Array) => { let s = ""; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); return btoa(s); };
const unb64 = (s: string) => { const bin = atob(s); const o = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) o[i] = bin.charCodeAt(i); return o; };
const prompt = (d: string) => [
  `This is a photo of one garment: ${d}. Parts of it may be hidden, creased, or overlapped by other clothes.`,
  "Render the complete garment as a clean e-commerce product photo: alone, laid flat or as if on an invisible mannequin, front view, centred, filling most of the frame.",
  "Background: plain pure white (#FFFFFF), no shadow, no floor, no hanger, no person, no other clothing or objects.",
  "Keep the exact colour, pattern, fabric texture, buttons, logos and proportions. Complete hidden parts plausibly and smooth creases, but do not restyle it and do not add text.",
].join(" ");

Deno.serve(async (req) => {
  if (Date.now() > EXPIRES || req.headers.get("x-fixup-code") !== CODE) return new Response("gone", { status: 410 });
  const input = await req.json().catch(() => null) as { id?: string; description?: string } | null;
  if (!input?.id || !input.description) return Response.json({ error: "bad input" }, { status: 400 });
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  const log = (entry: Record<string, unknown>) => db.from("ai_calls").insert({ user_id: OWNER, ...entry });
  const { data: item } = await db.from("items").select("id, name, cutout_path").eq("id", input.id).eq("user_id", OWNER).maybeSingle();
  const m = (item?.cutout_path as string | undefined)?.match(/^(.*\/)(\d+)[^/]*$/);
  if (!item || !m || !m[1].startsWith(`${OWNER}/`)) return Response.json({ error: "item not found" }, { status: 404 });
  const monthStart = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1)).toISOString();
  const { data: rows } = await db.from("ai_calls").select("cost_usd").eq("provider", "google").gte("created_at", monthStart);
  const spent = (rows ?? []).reduce((s, r) => s + Number(r.cost_usd ?? 0), 0);
  if (spent >= BUDGET - 0.1) return Response.json({ stop: "monthly Google budget reached", spent });
  const crop = `${m[1]}${m[2]}.jpg`;
  const { data: file } = await db.storage.from("cutouts").download(crop);
  if (!file) return Response.json({ error: "crop not found", crop });
  const bytes = new Uint8Array(await file.arrayBuffer());
  const t0 = Date.now();
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-goog-api-key": Deno.env.get("GEMINI_IMAGE_API_KEY") ?? Deno.env.get("GEMINI_API_KEY") ?? "" },
    body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: prompt(input.description.slice(0, 400)) }, { inline_data: { mime_type: sniffImageType(bytes, "image/jpeg"), data: b64(bytes) } }] }], generationConfig: { responseModalities: ["IMAGE"], imageConfig: { aspectRatio: "3:4" } } }),
    signal: AbortSignal.timeout(60_000),
  });
  const out = res.ok ? await res.json() : null;
  const part = out?.candidates?.[0]?.content?.parts?.find((p: { inlineData?: { data?: string } }) => p.inlineData?.data);
  const tokens = out?.usageMetadata?.promptTokenCount ?? 0;
  if (!part) {
    const error = res.ok ? `no image (${out?.candidates?.[0]?.finishReason})` : `HTTP ${res.status}: ${(await res.text()).slice(0, 150)}`;
    await log({ provider: "google", model: MODEL, task: "separate", latency_ms: Date.now() - t0, ok: false, error });
    return Response.json({ error });
  }
  const cost = Math.round((tokens * PRICE.input_token + PRICE.image) * 100_000) / 100_000;
  await log({ provider: "google", model: MODEL, task: "separate", images: 1, input_tokens: tokens, latency_ms: Date.now() - t0, ok: true, cost_usd: cost });
  const drawn = unb64(part.inlineData.data);
  const drawnPath = `${m[1]}${m[2]}-enhanced-${Date.now()}.png`;
  const up = await db.storage.from("cutouts").upload(drawnPath, drawn, { contentType: sniffImageType(drawn, "image/png") });
  if (up.error) return Response.json({ error: up.error.message });
  const cut = await cutout(drawn, sniffImageType(drawn, "image/png"), false);
  await log({ ...cut.log });
  let image = drawnPath, thumb: string | null = null;
  if (cut.ok) {
    const stem = drawnPath.replace(/\.png$/, "");
    const [a, b] = await Promise.all([
      db.storage.from("cutouts").upload(`${stem}-cutout.png`, cut.cutout, { contentType: "image/png" }),
      db.storage.from("cutouts").upload(`${stem}-thumb.png`, cut.thumb, { contentType: "image/png" }),
    ]);
    if (!a.error && !b.error) { image = `${stem}-cutout.png`; thumb = `${stem}-thumb.png`; }
  }
  const u = await db.from("items").update({ cutout_path: image, thumb_path: thumb, updated_at: new Date().toISOString() }).eq("id", item.id).eq("user_id", OWNER);
  return Response.json({ ok: !u.error, name: item.name, image, cut: cut.ok, cost, previous: item.cutout_path, error: u.error?.message });
});
