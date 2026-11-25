import { ContactResponseSchema, type ContactKind, type ContactResponse } from "@fit-check/schema";
import { invoke } from "./intake";

/**
 * Sends one "contact Roy" request (the `contact` Edge Function stores it and emails Roy). Never throws: a refusal
 * (daily_limit, bad_input) or a failure (network) is a reason. `emailed: false` still means it was received.
 */
export function sendContact(kind: ContactKind, message: string): Promise<ContactResponse> {
  return invoke({ kind, message }, ContactResponseSchema, "contact") as Promise<ContactResponse>;
}
