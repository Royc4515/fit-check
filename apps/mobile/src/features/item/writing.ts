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

/** What the screen knows when the user tries to leave it. */
export type LeaveState = {
  /** The field being written in, if any. */
  open: OpenText | null;
  /** A text save is on its way (the open field saving for a leave, or one sent by "שמירה" a moment ago). */
  saving: boolean;
  /** Fields whose last save failed and whose typed text is held only by the screen. */
  failed: readonly TextField[];
};

/**
 * What leaving the item screen must do first (DESIGN.md section 4, "יציאה מהמסך עם שינוי פתוח ותקין"):
 * - `leave`: nothing would be lost; an open field that is unchanged, or invalid (an emptied name, which can never be
 *   saved), is dropped and the screen goes now;
 * - `save-first`: the open field is changed and valid; it is saved once, and the screen goes only if that succeeds;
 * - `wait`: a save is already on its way; the screen goes when it succeeds and stays if it fails (no second write);
 * - `stay`: an earlier save failed while its field was closed; that field reopens with its text, nothing is written.
 */
export type LeaveDecision = { kind: "leave" } | { kind: "save-first"; edit: OpenText } | { kind: "wait" } | { kind: "stay"; field: TextField };

/** See `LeaveDecision`. Pure: the screen runs it on every way out (back, browser back, another item, removal). */
export function decideLeave(s: LeaveState): LeaveDecision {
  if (s.saving) return { kind: "wait" };
  if (s.open && resolveOpen(s.open) === "save") return { kind: "save-first", edit: s.open };
  const held = s.failed.find((f) => f !== s.open?.field);
  if (held) return { kind: "stay", field: held };
  return { kind: "leave" };
}
