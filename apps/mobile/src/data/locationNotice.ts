/**
 * The pure half of "say so when the current location cannot be used": which notice the location screen and the
 * profile row show for a combination of what was saved, what the permission says and whether a position is stored.
 * No I/O, so each combination is unit-tested; the reads live in location.ts.
 */

/**
 * What the permission reports, never by prompting:
 * - `granted` / `denied`: as the system says;
 * - `undetermined`: never asked. On web this is the browser's "prompt" state, which is also what a dismissed prompt
 *   leaves behind, so a refusal by dismissal and a first visit look identical;
 * - `unknown`: the status could not be read (no Permissions API, a thrown error).
 */
export type PermissionState = "granted" | "denied" | "undetermined" | "unknown";

/** `none`: nothing to say. `noPermission`: "my current location" is chosen (or was just tapped) and cannot be used. */
export type LocationNotice = "none" | "noPermission";

/** What is known about the current location. */
export type LocationFacts = {
  /** The saved choice's kind. */
  saved: "default" | "current" | "city";
  permission: PermissionState;
  /** A position from an earlier successful fix is stored on the device. */
  hasStoredFix: boolean;
  /** The user just tapped "my current location" and no position came back (refused, dismissed, unavailable). */
  tapFailed?: boolean;
};

/**
 * The notice for these facts:
 * - a tap that just failed is always said, whatever was saved (the user asked for it a moment ago);
 * - otherwise only a saved "current" can be a problem (a city or the default never needs a position);
 * - a refused permission is a problem even with a stored fix: that fix is where the user was, not where they are;
 * - an unasked or unreadable permission is a problem only with no stored fix, because then Today has nothing to
 *   show but the default city and says nothing about it (seen 2026-11-19: web reports "prompt" for a never-granted
 *   permission, which expo-location maps to undetermined, not denied);
 * - a granted permission is not a problem here: a failure to get a fix then shows up as a failed tap.
 */
export function locationNotice(f: LocationFacts): LocationNotice {
  if (f.tapFailed) return "noPermission";
  if (f.saved !== "current") return "none";
  if (f.permission === "denied") return "noPermission";
  if (f.permission === "granted") return "none";
  return f.hasStoredFix ? "none" : "noPermission";
}
