import { ContactInputSchema, type ContactInput, type ContactKind, type ContactResponse } from "@fit-check/schema/contact.ts";
import type { AuthResult } from "../_shared/auth.ts";

/** Requests one user may send in 24 hours: enough to follow up, too few to flood Roy's inbox. */
export const DAILY_PER_USER = 5;
/**
 * Requests from all users in 24 hours. Resend's free plan sends 100 emails a day (3,000 a month) and refuses the
 * rest without billing; 50 keeps this form well inside it.
 */
export const DAILY_ALL_USERS = 50;

/** Where the emails go: Roy's address, the same one the privacy page shows. Resend's free plan can only send there. */
export const CONTACT_TO = "roy.y.carmelli@gmail.com";

/** Hebrew labels for the subject and body: Roy reads these emails, in Hebrew. */
const KIND_LABEL: Record<ContactKind, string> = {
  more_quota: "בקשה להגדלת מכסה",
  problem: "משהו לא עובד",
  idea: "רעיון",
  other: "אחר",
};

/** Who sent the request, as Supabase Auth knows them. */
export type Sender = { id: string; email: string | null; name: string | null };
/** The sender's month, for the email: shown so Roy can decide on a raise without asking. */
export type SenderUsage = { percent: number | null; usd: number | null; usdLimit: number | null; cutouts: number | null; cutoutLimit: number | null } | null;

/**
 * The email Roy gets for one request. Pure. Plain text on purpose: no HTML to escape, and every mail client shows
 * it the same. `replyTo` is the sender's address, so answering the email answers them.
 */
export function composeEmail(input: ContactInput, sender: Sender, usage: SenderUsage, at: Date): { subject: string; text: string; replyTo: string | null } {
  const who = sender.email ?? sender.id;
  const usageLine =
    usage === null
      ? "שימוש החודש: ללא מכסה אישית"
      : `שימוש החודש: ${usage.percent ?? "?"}% (AI: $${usage.usd?.toFixed(2) ?? "?"} מתוך $${usage.usdLimit?.toFixed(2) ?? "?"}, הסרות רקע: ${usage.cutouts ?? "?"} מתוך ${usage.cutoutLimit ?? "?"})`;
  const lines = [
    `סוג הפנייה: ${KIND_LABEL[input.kind]}`,
    `מאת: ${sender.name ? `${sender.name} <${who}>` : who}`,
    `מזהה משתמש: ${sender.id}`,
    usageLine,
    `תאריך: ${at.toISOString()}`,
    "",
    "ההודעה:",
    input.message,
    "",
    "---",
    input.kind === "more_quota" && sender.email
      ? `להגדלה: לבקש מ-Claude במחבר Fit Check את quota_set עבור ${sender.email}.`
      : "כל הפניות הפתוחות: הכלי contact_requests במחבר Fit Check.",
  ];
  return { subject: `[Fit Check] ${KIND_LABEL[input.kind]} · ${who}`, text: lines.join("\n"), replyTo: sender.email };
}

/** What the handler needs from the outside world; index.ts passes the live ones, tests pass stubs. */
export interface ContactDeps {
  authenticate(req: Request): Promise<AuthResult>;
  /** Requests since `since`: this user's, or everyone's with null. Null when they cannot be counted. */
  countSince(userId: string | null, since: Date): Promise<number | null>;
  sender(userId: string): Promise<Sender>;
  usage(userId: string): Promise<SenderUsage>;
  /** Stores the request; its id, or null when it could not be stored. */
  save(userId: string, input: ContactInput): Promise<number | null>;
  /** Sends the email; false when it did not go out (no key, a refusal, a network error). Never throws. */
  sendEmail(email: { subject: string; text: string; replyTo: string | null }): Promise<boolean>;
  markEmailed(id: number): Promise<void>;
  now(): Date;
}

export const cors = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, x-client-info, apikey, content-type",
  "access-control-allow-methods": "POST, OPTIONS",
};
const json = (status: number, body: ContactResponse) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...cors } });

/**
 * contact: the in-app "contact Roy" form (Roy, 2026-11-25: a form that emails him in a set format, with a choice of
 * what it is about).
 *
 * Input (POST JSON, ContactInputSchema): `kind` (more_quota | problem | idea | other) and `message` (1-1000 chars).
 * Stores the request, then emails Roy (Resend, RESEND_API_KEY) with the sender's name, email and this month's
 * usage. The email failing does not fail the request: it is stored, and Roy sees it in the mcp contact_requests tool.
 *
 * Responses: 200 { ok: true, emailed } | 400 bad_input | 401 unauthorized | 405 | 429 daily_limit (DAILY_PER_USER
 * for this user, or DAILY_ALL_USERS for everyone; an uncountable day counts as full) | 500 storage_error.
 */
export async function handleContact(req: Request, deps: ContactDeps): Promise<Response> {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json(405, { ok: false, reason: "method" });
  const auth = await deps.authenticate(req);
  if (!auth.ok) return json(401, { ok: false, reason: "unauthorized" });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json(400, { ok: false, reason: "bad_input" });
  }
  const parsed = ContactInputSchema.safeParse(body);
  if (!parsed.success) return json(400, { ok: false, reason: "bad_input" });

  const now = deps.now();
  const since = new Date(now.getTime() - 24 * 3600 * 1000);
  const [mine, all] = await Promise.all([deps.countSince(auth.userId, since), deps.countSince(null, since)]);
  if (mine === null || all === null || mine >= DAILY_PER_USER || all >= DAILY_ALL_USERS) return json(429, { ok: false, reason: "daily_limit" });

  const id = await deps.save(auth.userId, parsed.data);
  if (id === null) return json(500, { ok: false, reason: "storage_error" });
  const [sender, usage] = await Promise.all([deps.sender(auth.userId), deps.usage(auth.userId)]);
  const emailed = await deps.sendEmail(composeEmail(parsed.data, sender, usage, now));
  if (emailed) await deps.markEmailed(id);
  return json(200, { ok: true, emailed });
}

/**
 * Sends one email through Resend. Without a verified domain Resend sends only from onboarding@resend.dev and only to
 * the account's own address, which is exactly this use: Roy writing to Roy. Never throws; false on any failure,
 * including a missing RESEND_API_KEY.
 */
export async function sendWithResend(
  email: { subject: string; text: string; replyTo: string | null },
  apiKey: string | undefined,
  fetchImpl: typeof fetch = fetch,
): Promise<boolean> {
  if (!apiKey) return false;
  try {
    const res = await fetchImpl("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({
        from: "Fit Check <onboarding@resend.dev>",
        to: [CONTACT_TO],
        subject: email.subject,
        text: email.text,
        ...(email.replyTo ? { reply_to: email.replyTo } : {}),
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) console.error("resend refused", res.status, (await res.text()).slice(0, 200));
    else await res.body?.cancel();
    return res.ok;
  } catch (error) {
    console.error("resend failed", error instanceof Error ? error.message : String(error));
    return false;
  }
}
