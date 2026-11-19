/**
 * Whether "remove the background again" would throw away an improved picture (DESIGN.md "שלב 2", "חיתוך רקע מחדש").
 *
 * The re-cut always starts from the item's original crop (`<dir>/<n>.jpg`, see `sourceCropPath`). Every stored image
 * keeps that `<n>` and adds suffixes that say how it was made:
 * - `<n>-cutout.png`: the worker's cutout of the original (intake-cutout); also `<n>-recut-<ts>-cutout.png` (MCP re-cut).
 * - `<n>-enhanced-<ts>.png` and its cutout `<n>-enhanced-<ts>-cutout.png`: a paid AI redraw (intake-separate
 *   `enhance`, MCP `item_redraw`); older ones are `<n>-enhanced.png` / `<n>-enhanced-cutout.png`.
 * - `<n>-clean-<ts>-cutout.png`: a picture cleaned by hand (the 2026-11-17 cleanup, CHANGELOG).
 * A cutout of the original photo replaces the latter two with something worse, so those need a confirmation first;
 * a plain cutout of the original is simply made again.
 * @param path the item's current `cutout_path`; null (a drawing) is never improved.
 * @returns true when the current picture is an AI redraw or a hand-cleaned image.
 */
export function recutReplacesImproved(path: string | null): boolean {
  if (!path) return false;
  const file = path.slice(path.lastIndexOf("/") + 1);
  // A suffix word anywhere after the leading number, as a whole word: `-enhanced-`, `-enhanced.png`, `-clean-`.
  return /^\d+(?:-[^/]*)?-(?:enhanced|clean)(?:-|\.)/.test(file);
}
