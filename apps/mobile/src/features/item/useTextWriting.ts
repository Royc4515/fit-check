import * as Haptics from "expo-haptics";
import { useCallback, useEffect, useRef, useState, type ComponentRef } from "react";
import { Platform, View } from "react-native";
import type { ItemChange } from "./edit";
import { changeFor, resolveOpen, type OpenText, type TextField } from "./writing";

/** How long "נשמר" stays under a field (DESIGN.md section 4, "כתיבה במקום"). */
export const SAVED_MS = 2000;

/** The line under one field: saved a moment ago, or the last save failed (with why). */
export type WritingStatus = { field: TextField; kind: "saved"; n: number } | { field: TextField; kind: "failed"; message: string; draft: string; original: string };

type Node = ComponentRef<typeof View>;

/** The writing state of the item screen's text fields, as `InlineText` and the screen use it. */
export type Writing = ReturnType<typeof useTextWriting>;

/** Web: focus the first button inside a wrapper (the library Button takes no ref). */
function focusButtonIn(node: Node | null | undefined): void {
  if (Platform.OS !== "web" || !(node instanceof HTMLElement)) return;
  node.querySelector<HTMLElement>('[role="button"]')?.focus();
}

/**
 * In-place writing of name, brand and notes (DESIGN.md section 4, "כתיבה במקום"). One field at a time; only "שמירה",
 * Enter (Ctrl/Cmd+Enter in notes), switching to another field or leaving the screen ever saves, and only a changed,
 * valid value (writing.ts `resolveOpen`). Blur does nothing. A save closes the field and goes through the item's edit
 * queue (optimistic, serialised, settles the store even after the screen is gone); success shows "נשמר" for two
 * seconds, failure reopens the field with the typed text and an error line whose retry saves it again.
 * @param save the item's save for one change; null when the screen is read-only.
 * @param failureText the error line's text for a failed write.
 */
export function useTextWriting(save: ((change: ItemChange) => Promise<void>) | null, failureText: (error: unknown) => string) {
  const [open, setOpenState] = useState<OpenText | null>(null);
  // The same, readable synchronously: a switch, a leave or an unmount must see the latest typed text.
  const openRef = useRef<OpenText | null>(null);
  const setOpen = useCallback((next: OpenText | null) => {
    openRef.current = next;
    setOpenState(next);
  }, []);
  const [status, setStatus] = useState<WritingStatus | null>(null);
  // A field reopened by a failed save does not take focus (the user may be elsewhere by then).
  const [quietOpen, setQuietOpen] = useState(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // Each field's edit button (pencil, or the dashed "add" chip): where focus returns after save or cancel.
  const pencils = useRef(new Map<TextField, Node | null>());
  const pencilRef = useCallback((field: TextField) => (node: Node | null) => void pencils.current.set(field, node), []);
  const refocus = useRef<TextField | null>(null);
  useEffect(() => {
    const field = refocus.current;
    if (open || !field) return;
    refocus.current = null;
    focusButtonIn(pencils.current.get(field));
  }, [open]);

  const savedCount = useRef(0);
  const commit = useCallback(
    (e: OpenText) => {
      if (!save) return;
      save(changeFor(e.field, e.draft)).then(
        () => {
          if (!mounted.current) return;
          savedCount.current += 1;
          setStatus({ field: e.field, kind: "saved", n: savedCount.current });
          if (Platform.OS !== "web") void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        },
        (error: unknown) => {
          console.error("Item text save failed", error);
          // Gone (left the screen): the edit queue already put the stored value back; nobody is left to tell.
          if (!mounted.current) return;
          if (Platform.OS !== "web") void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
          setStatus({ field: e.field, kind: "failed", message: failureText(error), draft: e.draft, original: e.original });
          // Reopen with what was typed, never the old text in silence; unless another field is being written now.
          if (!openRef.current) {
            setQuietOpen(true);
            setOpen({ ...e });
          }
        }
      );
    },
    [save, failureText, setOpen]
  );

  // "נשמר" leaves after two seconds, unless something newer replaced it.
  useEffect(() => {
    if (status?.kind !== "saved") return;
    const n = status.n;
    const timer = setTimeout(() => setStatus((s) => (s?.kind === "saved" && s.n === n ? null : s)), SAVED_MS);
    return () => clearTimeout(timer);
  }, [status]);

  /** Whatever the open field holds is resolved as on leaving it: saved, cancelled or simply closed. */
  const settleOpen = useCallback(() => {
    const cur = openRef.current;
    if (resolveOpen(cur) === "save" && cur) commit(cur);
  }, [commit]);

  /** Opens a field for writing; an open other field is resolved first (saved when changed and valid). */
  const start = useCallback(
    (field: TextField, value: string) => {
      const cur = openRef.current;
      if (cur?.field === field) return;
      settleOpen();
      setQuietOpen(false);
      setStatus((s) => (s && s.field === field ? null : s));
      setOpen({ field, original: value, draft: value });
    },
    [settleOpen, setOpen]
  );

  const setDraft = useCallback(
    (draft: string) => {
      const cur = openRef.current;
      if (cur) setOpen({ ...cur, draft });
    },
    [setOpen]
  );

  /** "ביטול" or Escape: the field closes, the stored value stays, focus goes back to the field's edit button. */
  const cancel = useCallback(() => {
    const cur = openRef.current;
    if (!cur) return;
    refocus.current = cur.field;
    setStatus((s) => (s && s.field === cur.field ? null : s));
    setOpen(null);
  }, [setOpen]);

  /** "שמירה", Enter, or the error line's retry. An unchanged field just closes; an empty name stays open. */
  const submit = useCallback(() => {
    const cur = openRef.current;
    const r = resolveOpen(cur);
    if (!cur || r === "cancel" || r === "none") return;
    if (r === "close") return cancel();
    refocus.current = cur.field;
    setStatus(null);
    setOpen(null);
    commit(cur);
  }, [cancel, commit, setOpen]);

  /** Retry of a failed save whose field is no longer open (another field was opened since). */
  const retry = useCallback(() => {
    if (status?.kind !== "failed") return;
    if (openRef.current?.field === status.field) return submit();
    setStatus(null);
    commit({ field: status.field, original: status.original, draft: status.draft });
  }, [status, submit, commit]);

  /**
   * Leaving the screen (back, hardware back, browser back, another item): an open field that is changed and valid is
   * saved as if "שמירה" was pressed; anything else is dropped. Safe to call twice.
   */
  const flush = useCallback(() => {
    const cur = openRef.current;
    if (!cur) return;
    setOpen(null);
    if (resolveOpen(cur) === "save") commit(cur);
  }, [commit, setOpen]);

  return { open, status, quietOpen, start, setDraft, submit, cancel, retry, flush, pencilRef };
}
