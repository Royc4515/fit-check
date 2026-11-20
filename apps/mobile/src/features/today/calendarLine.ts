/*
 * The calendar line above Today's hero (DESIGN.md "היום" item 1, "כשהלוח העברי מתעכב"). Pure, so the rule is tested
 * without a screen: the line says where the Hebcal request stands, and offers a button only when pressing it does
 * something.
 */

/** What the calendar line shows. */
export type CalendarLine =
  /** Nothing: the calendar is known and never was missing on this screen, and the outfit breaks no rule of it. */
  | { kind: "none" }
  /** Not known, its request still in flight (the first one, or a retry): "still loading", no action. */
  | { kind: "loading" }
  /** Not known, its request failed or timed out: "did not load", with "try again" (a press starts a new request). */
  | { kind: "failed" }
  /** Known now after being missing, or changed under an outfit: "has loaded"; `update` when the outfit breaks its rules. */
  | { kind: "loaded"; update: boolean };

/**
 * The calendar line's state. Pure; never throws.
 *
 * @param args.observes The observance switch: off, the calendar does not decide the outfit and no line is shown.
 * @param args.known A Hebcal answer covering the date is in use (stored or received).
 * @param args.pending The calendar request has not settled. While it is in flight a press could not start another
 * (the request is shared until it settles), so no button is offered.
 * @param args.wasMissing The calendar was missing at some point while this screen was mounted.
 * @param args.outdated The outfit on screen breaks the rules the calendar now gives the day (rulesStillFit).
 */
export function calendarLine(args: { observes: boolean; known: boolean; pending: boolean; wasMissing: boolean; outdated: boolean }): CalendarLine {
  if (args.observes && !args.known) return { kind: args.pending ? "loading" : "failed" };
  if (args.wasMissing || args.outdated) return { kind: "loaded", update: args.outdated };
  return { kind: "none" };
}
