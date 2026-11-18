import { useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Platform, Pressable, TextInput, View } from "react-native";
import { focusRingProps } from "../../components/ui";
import { useTypeTracking } from "../../components/ui/Type";
import { colors, layout } from "../../theme/tokens";
import { spoken } from "./a11y";

type Props = {
  value: string;
  /** What the text is ("Item name"), for the field's label and the button's spoken name. */
  label: string;
  /** What the control shows when the value is empty ("Add brand"): then also its whole spoken name. */
  emptyText?: string;
  /** Saves a changed value. The text shows the stored value, so a failed save simply shows the old one again. */
  onCommit: (next: string) => void;
  /** Editing started or was cancelled: the screen clears error lines that belonged to an earlier action. */
  onBegin?: () => void;
  /** The text at rest; pressing it starts editing. */
  children: ReactNode;
  /** The typography of the field while editing, matching the text at rest so nothing jumps. */
  size: "display-xl" | "body-sm";
  disabled?: boolean;
};

/** One line, always: a value saved from a field never carries a line break (Enter is "save", not "new line"). */
const oneLine = (s: string) => s.replace(/[\r\n]+/g, " ");

// A body-sm line with its underline is about 27 high; the 44 box (DESIGN.md: minimum touch target) is centred on it
// and the extra height is taken back by an equal negative margin, so the text sits exactly where it did.
// don't touch / the Pressable itself must be the box: hitSlop does nothing in react-native-web.
const SMALL_BOX_PULL = -8;

/**
 * Edit in place (DESIGN.md section 3 "פריט" item 2): the text is a button; pressing it swaps in a field in the same
 * face and size, focused. Return (Enter) or blur saves, Escape (web) cancels. Nothing is saved when nothing changed.
 * The spoken name starts with the visible text (WCAG "label in name"), then says what it is and that it edits.
 */
export function InlineText({ value, label, emptyText, onCommit, onBegin, children, size, disabled = false }: Props) {
  const { t, i18n } = useTranslation();
  const tracking = useTypeTracking();
  const [draft, setDraft] = useState<string | null>(null);
  // Hebrew is right-aligned, English left; the field does not inherit the page direction on web.
  const align = { textAlign: i18n.language === "en" ? "left" : "right" } as const;

  // don't touch / a ref, not the state: Escape unmounts the field, and the blur that unmounting fires still sees the
  // old render's draft, which would save the text the user just cancelled. It also makes Enter + the blur that
  // follows it save once, not twice.
  const live = useRef<string | null>(null);
  const start = () => {
    onBegin?.();
    live.current = value;
    setDraft(value);
  };
  const stop = (save: boolean) => {
    const text = live.current;
    live.current = null;
    setDraft(null);
    if (!save) onBegin?.();
    if (save && text !== null && oneLine(text).trim() !== value.trim()) onCommit(oneLine(text));
  };
  const edit = (text: string) => {
    // A touch keyboard's return in a multiline field arrives as a line break: it means "done".
    if (/[\r\n]/.test(text)) {
      live.current = text;
      return stop(true);
    }
    live.current = text;
    setDraft(text);
  };

  if (draft !== null) {
    const display = size === "display-xl";
    return (
      <TextInput
        value={draft}
        onChangeText={edit}
        onBlur={() => stop(true)}
        onSubmitEditing={() => stop(true)}
        onKeyPress={(e) => {
          if (Platform.OS !== "web") return;
          const key = e.nativeEvent.key;
          // Escape is a web/hardware-keyboard key; on a touch keyboard, clearing the change by hand is the cancel.
          if (key === "Escape") stop(false);
          // don't touch / a multiline field on web is a <textarea>, where Enter inserts a line break before any submit
          // handler runs (seen 2026-11-18: the name became "…\n" and the field stayed open). Stop the key, then save.
          else if (key === "Enter" && !("shiftKey" in e.nativeEvent && e.nativeEvent.shiftKey === true)) {
            e.preventDefault();
            stop(true);
          }
        }}
        autoFocus
        selectTextOnFocus
        // Multiline only so a long name wraps exactly as it does at rest; Enter still saves (above, and on native via
        // submitBehavior), it never adds a line.
        multiline={display}
        submitBehavior="blurAndSubmit"
        returnKeyType="done"
        accessibilityLabel={spoken(label)}
        placeholder={label}
        placeholderTextColor={colors["ink-faint"]}
        className={`border-b-2 border-ink pb-1 outline-none ${display ? "font-display text-display-xl text-ink" : "font-body text-body-sm text-ink"}`}
        // The 2px ink underline is the focus mark (the ring's weight); the browser's own box around a serif headline
        // would read as a form field dropped into the page.
        style={[align, display ? tracking.displayXl : null]}
      />
    );
  }

  const name = value ? t("item.editInline", { value, field: label }) : (emptyText ?? t("item.editInline", { value: t("item.empty"), field: label }));
  const small = size === "body-sm";
  return (
    <Pressable
      {...focusRingProps}
      onPress={start}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={spoken(name)}
      // Start-aligned box: the text inside sizes to its content and stays on the reading side (Tile caption note).
      style={{
        alignSelf: "flex-start",
        maxWidth: "100%",
        ...(small ? { minHeight: layout.hit, minWidth: layout.hit, justifyContent: "center", marginVertical: SMALL_BOX_PULL } : null),
      }}
    >
      <View>{children}</View>
    </Pressable>
  );
}
