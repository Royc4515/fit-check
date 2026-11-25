import { ShowcaseResponseSchema, type ShowcaseResponse } from "@fit-check/schema";
import { invoke } from "./intake";

/**
 * The owner's look for the sign-in cover (the public `showcase` Edge Function). Works signed out. Never throws; a
 * failure is a reason ("network", "preview", "none", ...), and the cover then keeps its drawing.
 */
export function fetchShowcase(): Promise<ShowcaseResponse> {
  return invoke({}, ShowcaseResponseSchema, "showcase") as Promise<ShowcaseResponse>;
}
