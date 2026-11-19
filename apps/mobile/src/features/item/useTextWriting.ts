import * as Haptics from "expo-haptics";
import { useCallback, useEffect, useRef, useState, type ComponentRef } from "react";
import { Platform, View } from "react-native";
import type { ItemChange } from "./edit";
import { changeFor, decideLeave, decideRemove, resolveOpen, type LeaveState, type OpenText, type TextField } from "./writing";

/** How long "נשמר" stays under a field (DESIGN.md section 4, "כתיבה במקום"). */
export const SAVED_MS = 2000;

/** "נשמר" under a field; `n` tells two saves of the same field apart. */
export type SavedLine = { field: TextField; n: number };

/** A save that failed: why, and the typed text, which only the screen holds now. */
export type FailedSave = { message: string; draft: string; original: string };

export type Failures = Partial<Record<TextField, FailedSave>>;

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
 * valid value (writing.ts). Blur does nothing. Saves go through the item's edit queue. Success shows "נשמר" for two
 * seconds; a failure keeps the typed text (the field reopens with it and takes focus, or, when another field is open,
 * an error line with "נסה שוב" stays under it until the text is saved or cancelled). Leaving the screen asks
 * `requestLeave`, which saves an open change first and lets the screen go only once nothing typed can be lost.
 * @param save the item's save for one change; null when the screen is read-only.
 * @param failureText the error line's text for a failed write.
 */
export function useTextWriting(save: ((change: ItemChange) => Promise<void>) | null, failureText: (error: unknown) => string) {
  const [open, setOpenState] = useState<OpenText | null>(null);
  // The same, readable synchronously: a switch, a leave or a settling write must see the latest typed text.
  const openRef = useRef<OpenText | null>(null);
  const setOpen = useCallback((next: OpenText | null) => {
    openRef.current = next;
    setOpenState(next);
  }, []);
  const [failures, setFailuresState] = useState<Failures>({});
  const failuresRef = useRef<Failures>({});
  const setFailures = useCallback((fn: (f: Failures) => Failures) => {
    failuresRef.current = fn(failuresRef.current);
    setFailuresState(failuresRef.current);
  }, []);
  const [saved, setSaved] = useState<SavedLine | null>(null);
  // Writes on their way, and whether the open field is the one saving (its "שמירה" shows busy).
  const inFlight = useRef(0);
  const [saving, setSaving] = useState(0);
  const [busy, setBusy] = useState(false);
  // Asks the open field to take focus again (a failed save): a counter, so the same field can be asked twice.
  const [focusAsk, setFocusAsk] = useState(0);
  // The way out the user took, kept while the save it needs is on its way; `refused` runs if that save fails.
  const pendingLeave = useRef<{ go: () => void; refused?: () => void; remove: boolean } | null>(null);
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

  // "נשמר" leaves after two seconds, unless something newer replaced it.
  useEffect(() => {
    if (!saved) return;
    const n = saved.n;
    const timer = setTimeout(() => setSaved((s) => (s?.n === n ? null : s)), SAVED_MS);
    return () => clearTimeout(timer);
  }, [saved]);

  const savedCount = useRef(0);
  // Assigned below; a settling write re-asks whether the pending way out may go now.
  const leaveRef = useRef<(proceed: () => void, refused?: () => void, remove?: boolean) => void>(() => undefined);

  /**
   * One write of a field's typed text. `keepOpen`: the field stays open and busy while it saves (a save before
   * leaving); otherwise the field has already closed (a "שמירה").
   */
  const commit = useCallback(
    (e: OpenText, keepOpen: boolean) => {
      if (!save) return;
      inFlight.current += 1;
      setSaving(inFlight.current);
      if (keepOpen) setBusy(true);
      const settle = () => {
        inFlight.current -= 1;
        if (!mounted.current) return false;
        setSaving(inFlight.current);
        if (keepOpen) setBusy(false);
        return true;
      };
      save(changeFor(e.field, e.draft)).then(
        () => {
          if (!settle()) return;
          setFailures((f) => {
            const next = { ...f };
            delete next[e.field];
            return next;
          });
          savedCount.current += 1;
          setSaved({ field: e.field, n: savedCount.current });
          if (keepOpen && openRef.current?.field === e.field) setOpen(null);
          if (Platform.OS !== "web") void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          const pending = pendingLeave.current;
          pendingLeave.current = null;
          if (pending) leaveRef.current(pending.go, pending.refused, pending.remove);
        },
        (error: unknown) => {
          console.error("Item text save failed", error);
          // Gone already: nothing is left to show. Cannot happen through `requestLeave`, which waits for the write.
          if (!settle()) return;
          if (Platform.OS !== "web") void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
          // The way out is cancelled: the screen stays with the text and the error.
          const refused = pendingLeave.current?.refused;
          pendingLeave.current = null;
          refused?.();
          setFailures((f) => ({ ...f, [e.field]: { message: failureText(error), draft: e.draft, original: e.original } }));
          const cur = openRef.current;
          if (!cur || cur.field === e.field) {
            // Reopened (or still open) with what was typed, and focused, never back to <body>.
            if (!cur) setOpen({ ...e });
            setFocusAsk((n) => n + 1);
          }
          // Another field is open: the error line with "נסה שוב" stays under this one until it is resolved.
        }
      );
    },
    [save, failureText, setOpen, setFailures]
  );

  /** Opens a field for writing; an open other field is resolved first. A field with a failed save opens its text. */
  const start = useCallback(
    (field: TextField, value: string) => {
      const cur = openRef.current;
      if (cur?.field === field) return;
      if (cur && resolveOpen(cur) === "save") commit(cur, false);
      const failed = failuresRef.current[field];
      setSaved((s) => (s?.field === field ? null : s));
      setOpen(failed ? { field, original: failed.original, draft: failed.draft } : { field, original: value, draft: value });
    },
    [commit, setOpen]
  );

  const setDraft = useCallback(
    (draft: string) => {
      const cur = openRef.current;
      if (cur) setOpen({ ...cur, draft });
    },
    [setOpen]
  );

  /** "ביטול" or Escape: the field closes, the typed text and any failure of it are dropped, focus goes to its pencil. */
  const cancel = useCallback(() => {
    const cur = openRef.current;
    if (!cur || busy) return;
    refocus.current = cur.field;
    setFailures((f) => {
      const next = { ...f };
      delete next[cur.field];
      return next;
    });
    setOpen(null);
  }, [busy, setOpen, setFailures]);

  /** "שמירה", Enter, or the open field's retry. An unchanged field just closes; an empty name stays open. */
  const submit = useCallback(() => {
    const cur = openRef.current;
    const r = resolveOpen(cur);
    if (!cur || busy || r === "cancel" || r === "none") return;
    if (r === "close") return cancel();
    refocus.current = cur.field;
    setOpen(null);
    commit(cur, false);
  }, [busy, cancel, commit, setOpen]);

  /** "נסה שוב" under a field that is not open (another one is): its held text is saved again. */
  const retry = useCallback(
    (field: TextField) => {
      if (openRef.current?.field === field) return submit();
      const failed = failuresRef.current[field];
      if (failed) commit({ field, original: failed.original, draft: failed.draft }, false);
    },
    [submit, commit]
  );

  /**
   * Every way out of the screen calls this with what it would do (fly back, follow the browser's back, open another
   * item), and so does removing the item (`remove`: its archive closes the screen, so it follows the same rule,
   * writing.ts `decideRemove`). `proceed` runs now when nothing typed can be lost, after the one save it needs when
   * that succeeds, and never when it fails: then the screen stays with the field, the text and the error
   * (writing.ts `decideLeave`). `refused` runs when `proceed` will not, so a caller can close what it opened.
   */
  const requestLeave = useCallback(
    (proceed: () => void, refused?: () => void, remove = false) => {
      const state: LeaveState = {
        open: openRef.current,
        saving: inFlight.current > 0,
        failed: Object.keys(failuresRef.current).filter((k): k is TextField => k === "name" || k === "brand" || k === "notes"),
      };
      const d = remove ? decideRemove(state) : decideLeave(state);
      if (d.kind === "leave" || d.kind === "archive") {
        if (openRef.current) setOpen(null);
        proceed();
      } else if (d.kind === "save-first") {
        pendingLeave.current = { go: proceed, refused, remove };
        setSaved(null);
        commit(d.edit, true);
      } else if (d.kind === "wait") {
        pendingLeave.current = { go: proceed, refused, remove };
      } else {
        const failed = failuresRef.current[d.field];
        if (failed) setOpen({ field: d.field, original: failed.original, draft: failed.draft });
        setFocusAsk((n) => n + 1);
        refused?.();
      }
    },
    [commit, setOpen]
  );
  useEffect(() => {
    leaveRef.current = requestLeave;
  }, [requestLeave]);

  /** Whether leaving now would need anything first (a navigator's "prevent remove" switch). */
  const holds =
    decideLeave({
      open,
      saving: saving > 0,
      failed: Object.keys(failures).filter((k): k is TextField => k === "name" || k === "brand" || k === "notes"),
    }).kind !== "leave";

  // A real field takes focus when it opens; only gallery fixtures turn this off.
  const autoFocus = true;
  return { open, failures, saved, busy, focusAsk, holds, autoFocus, start, setDraft, submit, cancel, retry, requestLeave, pencilRef };
}
