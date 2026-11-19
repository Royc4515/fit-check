/**
 * Today's date in Israel (`YYYY-MM-DD`). Shared by outfit.ts and context.ts so "today" means the same thing in every
 * tool; the app uses the same zone (DEFAULT_LOCATION). Inputs: an instant (default now). Never fails.
 */
export const israelDate = (now = new Date()): string =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
