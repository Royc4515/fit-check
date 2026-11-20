import type { PairWeights } from "@fit-check/engine";
import type { Item } from "@fit-check/schema";
import * as Haptics from "expo-haptics";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Platform } from "react-native";
import { correctionFailure } from "../../data/correction";
import type { PlannedDay } from "../../data/dayContext";
import { israelDate, localTime } from "../../data/localDate";
import type { SavedOutfit } from "../../data/savedOutfit";
import { useDayContext } from "../../data/useDayContext";
import { useFeedback } from "../../data/useFeedback";
import { useWardrobe } from "../../data/WardrobeProvider";
import { dayInForce } from "../today/dayInForce";
import { withWornChange } from "./collection";
import { patchOutfits } from "./store";
import { wearPress, wearTodayState, type WearTodayState } from "./wearToday";

/** Web ids of the two places focus goes after a press: the recorded line (its undo) and the wear button. */
export const FOCUS_WORN = "outfit-worn-status";
export const FOCUS_WEAR = "outfit-wear";
/** The first thing in a container that a keyboard can reach: react-native-web gives every live pressable tabindex 0. */
const FIRST_TABBABLE = '[tabindex="0"]:not([aria-disabled="true"])';
/** A little longer than the sheet's close spring takes to settle: its Modal hands focus back to the opener on unmount. */
const SHEET_SETTLE_MS = 700;

const NO_ITEMS: Item[] = [];
const NO_WEIGHTS: PairWeights = new Map();
const noPatch = () => undefined;
// The outfit screen records only on its saved row (wearSaved / correctToSaved); an engine candidate's row is never
// decided here. Rejecting keeps a stray call from ever writing a copy of the saved outfit.
const noRow = () => Promise.reject(new Error("the outfit screen records only on the saved row"));

/** A failure line: its message key and what "try again" does now (null: the line it is about carries the action). */
export type WearFailure = { messageKey: string; retry: (() => void) | null };

export type WearToday = {
  /** What the screen offers (wearToday.ts). `loading` until the day, the wardrobe and today's records are read. */
  state: WearTodayState;
  /** A write is on its way: the button and the lines' actions are inert. */
  busy: boolean;
  /** The garments today's wear sent to the laundry, when the wear shown is this outfit's. */
  laundered: string[];
  /** A failure that belongs beside the button (the wear or the replacement was not stored). */
  barFailure: WearFailure | null;
  /** A failure that belongs above the hero with the recorded line (undo, keep-home, the earlier wear not deleted). */
  wornFailure: WearFailure | null;
  /** The replace step is open. */
  confirming: boolean;
  /**
   * The planned day the wear is for when the day in force is not today (Friday evening for an observant user:
   * Shabbat), else null: the button and the recorded line then use Today's planned-day words (plannedKeys).
   */
  planned: "shabbat" | "holiday" | "yom_kippur" | null;
  press: () => void;
  confirmReplace: () => void;
  cancelReplace: () => void;
  undo: () => void;
  keepHome: () => void;
};

/**
 * "לובש היום" on a saved outfit's screen (DESIGN.md "שלב 5.2" item 4). Today's own feedback hook (useFeedback) for
 * today's date, so learning, laundry, undo and the correction after wearing are Today's code, not a copy; the wear goes
 * on the saved row. The hook re-reads when another screen writes a wear and shares the laundry state (feedbackSync),
 * so Today and this screen agree without a reload; the collection's count and date follow through the outfits store.
 *
 * Failure modes: a failed wear or replacement brings the bar back with an error line whose "try again" is computed from
 * the state at that moment (wearPress), never a replay; a correction whose earlier wear could not be deleted shows the
 * corrected wear with an error line that deletes only. Nothing half-recorded is hidden: every stored row is on screen.
 * In the design preview every write rejects, which is this failure path.
 */
export function useWearToday(userId: string, outfit: SavedOutfit | null, garments: readonly Item[]): WearToday {
  const wardrobe = useWardrobe();
  const day = useDayContext();
  // Until the day's context lands (its location's time zone), Israel's date; the bar waits for the real one anyway.
  const date = day?.date ?? israelDate().date;
  const onWornChange = useCallback(
    (record: { outfitId: string; date: string }, delta: 1 | -1) => patchOutfits(userId, (list) => withWornChange(list, record.outfitId, delta, record.date)),
    [userId]
  );
  const ready = wardrobe.status === "ready";
  const feedback = useFeedback({
    userId,
    date,
    // Read up to the last planned day, as Today does, so a wear recorded there for Shabbat is seen here.
    until: day?.chain.at(-1)?.date ?? date,
    dayType: day?.dayType ?? "weekday",
    items: ready ? wardrobe.items : NO_ITEMS,
    pairWeights: ready ? wardrobe.pairWeights : NO_WEIGHTS,
    patch: ready ? wardrobe.patch : noPatch,
    resolveRow: noRow,
    onWornChange,
  });
  const { actions, history, busy, failedOn, correction } = feedback;

  // The day a wear pressed here belongs to: Today's own rule (dayInForce), decided once when the day's records are
  // read, as Today decides its opening tab, so a press here never flips the screen to Shabbat under the thumb. The
  // rule's clock is the location's local time at that moment.
  const [inForce, setInForce] = useState<{ date: string; planned: PlannedDay | null } | null>(null);
  if (inForce === null && day && history) {
    const forDate = dayInForce({ day, now: localTime(day.tz), history });
    setInForce({ date: forDate, planned: day.chain.find((d) => d.date === forDate) ?? null });
  }
  const forDate = inForce?.date ?? date;
  const planned = inForce?.planned ?? null;

  const state = useMemo<WearTodayState>(() => {
    if (!outfit) return { kind: "loading" };
    const records = inForce && ready && history ? (inForce.planned ? history.ahead.filter((r) => r.date === inForce.date) : history.today) : null;
    return wearTodayState({ outfit, garments, today: records });
  }, [outfit, garments, inForce, ready, history]);

  // The replacement the user confirmed, by the earlier wear's id: a "try again" of it does not ask a second time.
  const [confirmedEarlier, setConfirmedEarlier] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  // Where focus goes once the write has settled (web): the recorded line's undo, or the wear button after an undo.
  const [focusRequest, setFocusRequest] = useState<{ after: "wear" | "undo"; n: number; settle: boolean } | null>(null);
  const focusHandled = useRef(0);
  const requestFocus = (after: "wear" | "undo", settle = false) => setFocusRequest((cur) => ({ after, settle, n: (cur?.n ?? 0) + 1 }));
  const stateKind = state.kind;
  useEffect(() => {
    if (!focusRequest || busy || Platform.OS !== "web" || focusHandled.current === focusRequest.n) return;
    focusHandled.current = focusRequest.n;
    const targetId = stateKind === "worn" ? FOCUS_WORN : FOCUS_WEAR;
    const within = () => {
      const el = document.getElementById(targetId);
      return el ? (el.querySelector<HTMLElement>(FIRST_TABBABLE) ?? el) : null;
    };
    within()?.focus();
    if (!focusRequest.settle) return;
    // don't touch / after the replace step the sheet's Modal gives focus back to its opener (the wear button, gone by
    // then) when it unmounts, over what was just set. Look again once it has settled, only if focus was lost.
    window.setTimeout(() => {
      const at = document.activeElement;
      if (!at || at === document.body) within()?.focus();
    }, SHEET_SETTLE_MS);
  }, [focusRequest, busy, stateKind]);

  const saved = useMemo(() => (outfit ? { outfitId: outfit.id, itemIds: outfit.itemIds } : null), [outfit]);

  const press = () => {
    if (!saved || busy) return;
    const next = wearPress(state, confirmedEarlier);
    if (next.kind === "none") return;
    if (next.kind === "confirm") {
      actions.dismissFailure();
      setConfirming(true);
      return;
    }
    if (Platform.OS !== "web") void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (next.kind === "wear") void actions.wearSaved(saved, { date: forDate, dayType: planned?.dayType ?? day?.dayType ?? "weekday" }).then(() => requestFocus("wear"));
    else void actions.correctToSaved(next.earlier, saved).then(() => requestFocus("wear"));
  };

  const confirmReplace = () => {
    if (!saved || busy || state.kind !== "replace") return;
    const earlier = state.earlier;
    setConfirmedEarlier(earlier.wearId);
    setConfirming(false);
    if (Platform.OS !== "web") void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    void actions.correctToSaved(earlier, saved).then(() => requestFocus("wear", true));
  };

  const worn = state.kind === "worn" ? state.record : null;
  const undo = () => {
    if (!worn || busy) return;
    void actions.undo(worn).then(() => requestFocus("undo"));
  };
  const laundered = worn && feedback.laundered?.wearId === worn.wearId ? feedback.laundered.itemIds : [];
  const keepHome = () => {
    if (laundered.length > 0 && !busy) void actions.keepHome(laundered);
  };

  // A failure belongs to the line it is about: beside the button while the outfit is not worn, above the hero with
  // the recorded line once it is.
  const failed = failedOn !== null && failedOn === forDate;
  let barFailure: WearFailure | null = null;
  let wornFailure: WearFailure | null = null;
  if (correction && correction.date === forDate) {
    const { messageKey } = correctionFailure(correction.stage);
    // "record": nothing changed, the earlier wear stands: try again is a fresh press (the confirmed wear is replaced
    // without asking again; a day that changed meanwhile is decided anew). "delete": the corrected wear stands and
    // try again deletes the earlier one only.
    if (correction.stage === "record") barFailure = { messageKey, retry: press };
    else wornFailure = { messageKey, retry: correction.retry };
  } else if (failed) {
    // Worn: an undo or "keep out of the laundry" failed; their own actions are on the recorded lines, as on Today.
    if (state.kind === "worn") wornFailure = { messageKey: "today.status.failed", retry: null };
    else barFailure = { messageKey: "today.status.failed", retry: press };
  }

  return {
    state,
    busy,
    laundered,
    barFailure,
    wornFailure,
    confirming,
    press,
    confirmReplace,
    cancelReplace: () => setConfirming(false),
    undo,
    keepHome,
    planned: planned?.kind ?? null,
  };
}
