import { anthropicBudgetAllows, googleBudgetAllows, MONTHLY_ANTHROPIC_BUDGET_USD, MONTHLY_GOOGLE_BUDGET_USD } from "./budget.ts";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

Deno.test("a call is allowed only while spend plus its price stays within the cap", () => {
  assert(googleBudgetAllows(0, 0.055), "empty month");
  assert(googleBudgetAllows(MONTHLY_GOOGLE_BUDGET_USD - 0.5, 0.5), "exactly at the cap");
  assert(!googleBudgetAllows(MONTHLY_GOOGLE_BUDGET_USD - 0.05, 0.055), "would pass the cap");
  assert(!googleBudgetAllows(MONTHLY_GOOGLE_BUDGET_USD, 0.001), "spent");
});

Deno.test("unknown spend counts as spent", () => {
  assert(!googleBudgetAllows(null, 0), "null spend never allows a call");
});

Deno.test("Anthropic: calls run below the cap, stop at it, and never on unknown spend", () => {
  assert(MONTHLY_ANTHROPIC_BUDGET_USD < 100, "the cap stays below the $100 monthly credit");
  assert(anthropicBudgetAllows(0), "empty month");
  assert(anthropicBudgetAllows(MONTHLY_ANTHROPIC_BUDGET_USD - 0.01), "just below the cap");
  assert(!anthropicBudgetAllows(MONTHLY_ANTHROPIC_BUDGET_USD), "at the cap");
  assert(!anthropicBudgetAllows(null), "unknown spend");
});
