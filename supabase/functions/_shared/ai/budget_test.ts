import { googleBudgetAllows, MONTHLY_GOOGLE_BUDGET_USD } from "./budget.ts";

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
