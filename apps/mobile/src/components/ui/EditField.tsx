import { useEffect, useLayoutEffect, useRef, useState, type ComponentRef, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Platform, Text, TextInput, View, type StyleProp, type TextStyle } from "react-native";
import { colors, layout } from "../../theme/tokens";
import { Button } from "./Button";

type Props = {
  value: string;
  onChangeText: (text: string) => void;
  /** "שמירה", Enter (one line) or Ctrl/Cmd+Enter (multiline). The key paths call it even when `canSave` is false. */
  onSave: () => void;
  /** "ביטול" or Escape. */
  onCancel: () => void;
  /** Enables the save button: something changed and the value is valid. */
  canSave: boolean;
  /** Real free text: Enter is a new line, Ctrl/Cmd+Enter saves. Otherwise one value, where Enter saves. */
  multiline?: boolean;
  /** A one-line value that may be long (a name in a headline face): it wraps instead of scrolling sideways. */
  wrap?: boolean;
  maxLength?: number;
  /** From this many characters a `n/max` counter shows at the end of the button row (needs `maxLength`). */
  counterFrom?: number;
  /** Spoken counter, e.g. "412 of 500 characters". */
  counterLabel?: (n: number, max: number) => string;
  /** The field's name for screen readers ("Item name"). */
  accessibilityLabel: string;
  placeholder?: string;
  /** Typography of the text, matching the text at rest (NativeWind classes). */
  textClassName?: string;
  textStyle?: StyleProp<TextStyle>;
  /** Focus the field when it appears (default). Off for a field shown without being typed in (a gallery fixture). */
  autoFocus?: boolean;
  /** A save of this field is on its way: "שמירה" shows it is busy, neither button acts. */
  busy?: boolean;
  /** Each change asks the field to take focus again, caret at the end (a failed save: never back to <body>). */
  focusAsk?: number;
  /** Under the row: the field's status line, if any. */
  children?: ReactNode;
};

/** A multiline field opens at least this tall (about three body lines) and grows with its text. */
const MULTILINE_MIN = 96;
/** Room kept between the button row and the bottom of what is visible (the on-screen keyboard's top). */
const REVEAL_MARGIN = 16;
/** Numbers stay LTR inside Hebrew text (DESIGN.md section 2). */
const ltr = (s: string) => `⁦${s}⁩`;

type Node = ComponentRef<typeof View>;

/**
 * Web: brings the button row into the part of the screen that is actually visible. `visualViewport` is the page
 * minus the on-screen keyboard; `scrollIntoView` only knows the layout viewport, which the keyboard does not shrink
 * on iOS, so the nearest scrolling ancestor is moved by hand.
 */
function revealOnWeb(node: Node | null): void {
  if (!(node instanceof HTMLElement)) return;
  const vv = window.visualViewport;
  const top = vv ? vv.offsetTop : 0;
  const bottom = top + (vv ? vv.height : window.innerHeight);
  const r = node.getBoundingClientRect();
  const down = r.bottom + REVEAL_MARGIN - bottom;
  const up = r.top - REVEAL_MARGIN - top;
  const dy = down > 0 ? down : up < 0 && r.height < bottom - top ? up : 0;
  if (dy === 0) return;
  for (let el = node.parentElement; el; el = el.parentElement) {
    const oy = getComputedStyle(el).overflowY;
    if ((oy === "auto" || oy === "scroll") && el.scrollHeight > el.clientHeight) {
      el.scrollTop += dy;
      return;
    }
  }
  window.scrollBy(0, dy);
}

/**
 * A field being written in (DESIGN.md section 4, "כתיבה במקום"): a framed box (ivory, 1px ink, radius 6, 12 in),
 * focused with the caret at the end, and under it one row with "שמירה" (ink) and "ביטול" (text), and the counter at
 * the row's end. Leaving the field does nothing: it stays open with its text until one of the two is chosen, by
 * button or key. The row is kept above the on-screen keyboard on web; on native the screen's scroll view handles the
 * keyboard (`automaticallyAdjustKeyboardInsets`, Android's resize mode).
 */
export function EditField({
  value,
  onChangeText,
  onSave,
  onCancel,
  canSave,
  multiline = false,
  wrap = false,
  maxLength,
  counterFrom,
  counterLabel,
  accessibilityLabel,
  placeholder,
  textClassName = "font-body text-body text-ink",
  textStyle,
  autoFocus = true,
  busy = false,
  focusAsk = 0,
  children,
}: Props) {
  const { t } = useTranslation();
  const input = useRef<ComponentRef<typeof TextInput>>(null);
  const row = useRef<Node>(null);
  const placed = useRef(false);
  // A textarea does not grow (or shrink) by itself on web, and its scroll height never falls below the height it was
  // given, so the field takes the height of an invisible copy of its text laid out in the same box (`mirror` below).
  // Native multiline inputs size themselves.
  const [mirrorH, setMirrorH] = useState(0);
  const grows = (multiline || wrap) && Platform.OS === "web";

  // The caret goes to the end once, on the first focus: a name is usually corrected at its end, a note added to.
  const caretToEnd = () => {
    if (placed.current) return;
    placed.current = true;
    const end = value.length;
    if (Platform.OS !== "web") return input.current?.setSelection(end, end);
    // don't touch / next frame: the browser puts a focused textarea's caret at the start after the focus event, so a
    // selection set inside the handler was overwritten and typing went before the name (seen 2026-11-19).
    requestAnimationFrame(() => {
      const node: unknown = input.current;
      // Only over the browser's own caret at the start: a selection the user already made (select all) is theirs.
      if ((node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement) && node.selectionStart === 0 && node.selectionEnd === 0) {
        node.setSelectionRange(node.value.length, node.value.length);
      }
    });
  };

  // A failed save asks for focus back in the field, caret at the end. The first value is the mount (autoFocus did it).
  const firstAsk = useRef(focusAsk);
  useEffect(() => {
    if (focusAsk === firstAsk.current) return;
    const node: unknown = input.current;
    input.current?.focus();
    if (Platform.OS !== "web") return;
    if (node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement) node.setSelectionRange(node.value.length, node.value.length);
  }, [focusAsk]);

  // Web, also before the next frame: a key typed right after the tap must already land at the end.
  useLayoutEffect(() => {
    const node: unknown = input.current;
    if (Platform.OS !== "web" || !(node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement)) return;
    if (document.activeElement === node) node.setSelectionRange(node.value.length, node.value.length);
  }, []);

  useEffect(() => {
    if (Platform.OS !== "web") return;
    // Only a field that is being typed in pulls the page: a field shown without focus (a failed save reopening it,
    // a gallery fixture) must not scroll anything.
    const typing = () => {
      const node: unknown = input.current;
      return node instanceof HTMLElement && document.activeElement === node;
    };
    const frame = requestAnimationFrame(() => {
      if (typing()) revealOnWeb(row.current);
    });
    // The on-screen keyboard opening (or the window shrinking) after the field took focus.
    const vv = window.visualViewport;
    const onResize = () => {
      if (typing()) revealOnWeb(row.current);
    };
    vv?.addEventListener("resize", onResize);
    window.addEventListener("resize", onResize);
    return () => {
      cancelAnimationFrame(frame);
      vv?.removeEventListener("resize", onResize);
      window.removeEventListener("resize", onResize);
    };
  }, []);

  const change = (text: string) => {
    if (multiline) return onChangeText(text);
    // A touch keyboard's return in a one-line field can arrive as a line break: it means "save", never a new line.
    if (/[\r\n]/.test(text)) {
      onChangeText(text.replace(/[\r\n]+/g, " "));
      onSave();
      return;
    }
    onChangeText(text);
  };

  const counter =
    maxLength !== undefined && counterFrom !== undefined && value.length >= counterFrom ? (
      <Text
        className="ms-auto font-mono text-num-sm text-ink-soft"
        accessibilityLabel={counterLabel?.(value.length, maxLength)}
      >
        {ltr(`${value.length}/${maxLength}`)}
      </Text>
    ) : null;

  return (
    <View>
      {grows ? (
        // Same face, padding and frame width as the field; a new empty last line counts as a line.
        <Text
          aria-hidden
          pointerEvents="none"
          onLayout={(e) => setMirrorH(Math.ceil(e.nativeEvent.layout.height))}
          className={`border border-transparent p-3 ${textClassName}`}
          style={[{ position: "absolute", top: 0, start: 0, end: 0, opacity: 0, textAlign: "start" }, textStyle]}
        >
          {value.endsWith("\n") ? `${value} ` : value || placeholder || " "}
        </Text>
      ) : null}
      <TextInput
        ref={input}
        value={value}
        onChangeText={change}
        onFocus={caretToEnd}
        onSubmitEditing={multiline ? undefined : onSave}
        onKeyPress={(e) => {
          if (Platform.OS !== "web") return;
          const ev = e.nativeEvent;
          // The DOM keyboard event carries the modifier keys; RN's type only declares `key`.
          const flag = (k: "ctrlKey" | "metaKey" | "shiftKey" | "isComposing") => Reflect.get(ev, k) === true;
          if (ev.key === "Escape") {
            e.preventDefault();
            onCancel();
            return;
          }
          if (ev.key !== "Enter" || flag("isComposing")) return;
          if (multiline) {
            if (flag("ctrlKey") || flag("metaKey")) {
              e.preventDefault();
              onSave();
            }
            return;
          }
          // don't touch / a wrapping field on web is a <textarea>, where Enter inserts a line break before any submit
          // handler runs (seen 2026-11-18: the name became "…\n"). Stop the key, then save.
          e.preventDefault();
          if (!flag("shiftKey")) onSave();
        }}
        autoFocus={autoFocus}
        multiline={multiline || wrap}
        submitBehavior={multiline ? "newline" : "submit"}
        returnKeyType={multiline ? "default" : "done"}
        maxLength={maxLength}
        accessibilityLabel={accessibilityLabel}
        placeholder={placeholder}
        placeholderTextColor={colors["ink-faint"]}
        className={`rounded border border-ink bg-ivory p-3 outline-none ${textClassName}`}
        style={[
          { textAlign: "start" },
          multiline ? { minHeight: MULTILINE_MIN, textAlignVertical: "top" } : null,
          grows && mirrorH > 0 ? { height: Math.max(multiline ? MULTILINE_MIN : 0, mirrorH) } : null,
          textStyle,
        ]}
      />
      {/* Start-aligned in reading order: "שמירה" first, then "ביטול"; the counter at the row's end. */}
      <View ref={row} className="mt-3 flex-row flex-wrap items-center" style={{ columnGap: 24, rowGap: 8, minHeight: layout.control }}>
        <Button variant="ink" label={busy ? t("ui.saving") : t("ui.save")} onPress={onSave} disabled={!canSave || busy} />
        <Button variant="text" label={t("ui.cancel")} onPress={onCancel} disabled={busy} />
        {counter}
      </View>
      {children}
    </View>
  );
}
