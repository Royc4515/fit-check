import { z } from "zod";

/** What a contact request is about; the form's choice buttons, in this order. */
export const CONTACT_KINDS = ["more_quota", "problem", "idea", "other"] as const;
export type ContactKind = (typeof CONTACT_KINDS)[number];

/** Longest message the form accepts (the table checks the same). */
export const CONTACT_MAX_CHARS = 1000;

export const ContactInputSchema = z
  .object({
    kind: z.enum(CONTACT_KINDS),
    message: z.string().trim().min(1).max(CONTACT_MAX_CHARS),
  })
  .strict();
export type ContactInput = z.infer<typeof ContactInputSchema>;

/**
 * The `contact` function's answer. `emailed`: whether the email to Roy went out; the request is stored either way,
 * so the app thanks the user in both cases.
 */
export const ContactResponseSchema = z.union([
  z.object({ ok: z.literal(true), emailed: z.boolean() }),
  z.object({ ok: z.literal(false), reason: z.string() }),
]);
export type ContactResponse = z.infer<typeof ContactResponseSchema>;
