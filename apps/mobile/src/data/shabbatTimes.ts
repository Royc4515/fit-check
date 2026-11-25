/*
 * Shabbat and holiday times now live in @fit-check/schema (shabbat-times.ts) so the app and the mcp Edge Function plan
 * "the day in force" with the same code (moved 2026-11-25). Re-exported here so the app's imports stay as they were.
 */
export {
  CHAIN_MAX_DAYS,
  chainTabLabels,
  defaultTab,
  isYomKippur,
  phoneFreeChain,
  PLAN_AHEAD_MINUTES,
  shabbatTimes,
  stripNiqqud,
  type ChainTabLabel,
  type HebcalItem,
  type PhoneFreeDay,
  type ShabbatTimes,
} from "@fit-check/schema";
