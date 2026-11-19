import { NOTES_MAX, type ItemChange } from "./edit";

/*
 * In-place writing on the item screen (DESIGN.md section 4, "כתיבה במקום"): nothing is saved without an explicit
 * action, and leaving the field neither saves nor cancels. The decisions about an open field are pure and live here,
 * so the screen and the tests agree on them.
 */

/** The three free-text fields of an item. */
export type TextField = "name" | "brand" | "notes";

/** The one field being written in: what it held when editing started, and what is typed now. */
export type OpenText = { field: TextField; original: string; draft: string };

/**
 * What to do with an open field when the user leaves it for something else (another field, another item, the
 * previous screen) or presses Enter:
 * - `save`: changed and valid; saved as if "שמירה" was pressed (typed text is never thrown away silently);
 * - `cancel`: changed but invalid (an empty name); nothing is written, the old value stays;
 * - `close`: nothing changed; the field just closes;
 * - `none`: no field is open.
 */
export type Resolution = "save" | "cancel" | "close" | "none";

/** One line, always: a name or a brand never carries a line break (a touch keyboard's return arrives as one). */
export const oneLine = (s: string) => s.replace(/[\r\n]+/g, " ");

/** The value a field's text would be stored as (the same rules as `editPayload`). */
export function storedForm(field: TextField, text: string): string {
  return field === "notes" ? text.trim().slice(0, NOTES_MAX).trim() : oneLine(text).trim();
}

/** The typed text differs from what was there, in the form it would be stored. */
export function isChanged(e: OpenText): boolean {
  return storedForm(e.field, e.draft) !== storedForm(e.field, e.original);
}

/** A name must not be empty; a brand or a note may be (it clears them). */
export function isValid(e: OpenText): boolean {
  return e.field !== "name" || storedForm("name", e.draft) !== "";
}

/** Whether "שמירה" is enabled: something changed and the result is valid. */
export function canSave(e: OpenText): boolean {
  return isChanged(e) && isValid(e);
}

/** See `Resolution`. Used when switching to another field, when leaving the screen, and for Enter. */
export function resolveOpen(e: OpenText | null): Resolution {
  if (!e) return "none";
  if (!isChanged(e)) return "close";
  return isValid(e) ? "save" : "cancel";
}

/** The edit-queue change for a field's typed text. */
export function changeFor(field: TextField, draft: string): ItemChange {
  if (field === "name") return { name: oneLine(draft) };
  if (field === "brand") return { brand: oneLine(draft) };
  return { notes: draft };
}
