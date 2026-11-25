import { describe, expect, it } from "vitest";
import { CONTACT_MAX_CHARS, ContactInputSchema, ContactResponseSchema } from "./contact.ts";

describe("ContactInputSchema", () => {
  it("trims the message and accepts each kind", () => {
    for (const kind of ["more_quota", "problem", "idea", "other"]) {
      expect(ContactInputSchema.parse({ kind, message: "  hi  " })).toEqual({ kind, message: "hi" });
    }
  });
  it("rejects an empty or too long message, an unknown kind and extra fields", () => {
    expect(ContactInputSchema.safeParse({ kind: "idea", message: "   " }).success).toBe(false);
    expect(ContactInputSchema.safeParse({ kind: "idea", message: "x".repeat(CONTACT_MAX_CHARS + 1) }).success).toBe(false);
    expect(ContactInputSchema.safeParse({ kind: "spam", message: "x" }).success).toBe(false);
    expect(ContactInputSchema.safeParse({ kind: "idea", message: "x", to: "a@b.c" }).success).toBe(false);
  });
});

describe("ContactResponseSchema", () => {
  it("parses success with and without the email, and a refusal", () => {
    expect(ContactResponseSchema.safeParse({ ok: true, emailed: false }).success).toBe(true);
    expect(ContactResponseSchema.safeParse({ ok: false, reason: "daily_limit" }).success).toBe(true);
  });
});
