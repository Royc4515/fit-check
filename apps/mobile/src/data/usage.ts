import { UsageResponseSchema, type UsageResponse } from "@fit-check/schema";
import { invoke } from "./intake";

/**
 * This month's usage for the signed-in user (the `usage` Edge Function): their own allowance, and for the owner the
 * whole account's caps. Never throws; a failure is a reason ("network", "preview", ...).
 */
export function fetchUsage(): Promise<UsageResponse> {
  return invoke({}, UsageResponseSchema, "usage") as Promise<UsageResponse>;
}
