import { useEffect, useRef, useState, type ComponentRef, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Platform, Pressable, Text, TextInput, View } from "react-native";
import { focusRingProps } from "../../components/ui";
import { headingProps, useTypeTracking, type HeadingLevel } from "../../components/ui/Type";
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
  size: "display-xl" | "body" | "body-sm";
  disabled?: boolean;
  /**
   * Free text over several lines (the notes): Enter inserts a line break instead of saving, the field grows with its
   * text, and only leaving the field saves (Escape still cancels on web). Without it the value is one line, always.
   */
  multiline?: boolean;
  /** The field stops taking text here. */
  maxLength?: number;
  /** From this many characters a `n/max` counter shows under the field (needs `maxLength`). */
  counterFrom?: number;
  /** Placeholder while editing an empty value; defaults to `label`. */
  placeholder?: string;
  /**
   * The text is a heading (the item's name): at rest the button sits inside a heading of this level, so the outline
   * keeps its title. While the field is open there is no heading: a heading that wraps a text input is announced
   * as a heading containing a field. Put the text in `children` with `Display level={null}`, so it is not a second heading.
   */
  headingLevel?: HeadingLevel;
};

/** One line, always: a value saved from a field never carries a line break (Enter is "save", not "new line"). */
const oneLine = (s: string) => s.replace(/[\r\n]+/g, " ");

// A body-sm line with its underline is about 27 high; the 44 box (DESIGN.md: minimum touch target) is centred on it
// and the extra height is taken back by an equal negative margin, so the text sits exactly where it did.
// don't touch / the Pressable itself must be the box: hitSlop does nothing in react-native-web.
const SMALL_BOX_PULL = -8;
/** A free-text field opens at least this tall (spacing scale; about three body lines) and grows with its text. */
const MULTILINE_MIN = 96;

/** Numbers stay LTR inside Hebrew text (DESIGN.md section 2). */
const ltr = (s: string) => `⁦${s}⁩`;

/**
 * Edit in place (DESIGN.md section 3 "פריט" item 2): the text is a button; pressing it swaps in a field in the same
 * face and size, focused. Return (Enter) or blur saves, Escape (web) cancels. Nothing is saved when nothing changed.
 * `multiline` (the notes): Enter is a new line and only blur saves. The spoken name starts with the visible text
 * (WCAG "label in name"), then says what it is and that it edits.
 */
export function InlineText({
  value,
  label,
  emptyText,
  onCommit,
  onBegin,
  children,
  size,
  disabled = false,
  headingLevel,
  multiline = false,
  maxLength,
  counterFrom,
  placeholder,
}: Props) {
  const { t } = useTranslation();
  const tracking = useTypeTracking();
  const [draft, setDraft] = useState<string | null>(null);
  const [fieldHeight, setFieldHeight] = useState(MULTILINE_MIN);
  // Free text keeps its line breaks; a one-line value never carries one.
  const clean = multiline ? (s: string) => s : oneLine;
  // The page's start side, resolved from the layout direction (react-native-web reads the root `dir`, native the
  // drawn direction): a language-chosen left/right was wrong on native until a restart (verification D9).
  const align = { textAlign: "start" } as const;
  const button = useRef<ComponentRef<typeof Pressable>>(null);
  // Set when a key (Enter, Escape) closed the field: focus goes back to the edit button, not to <body> (verification
  // N3). Not on blur: a blur means focus already went somewhere the user chose.
  const refocus = useRef(false);
  useEffect(() => {
    if (draft !== null || !refocus.current) return;
    refocus.current = false;
    if (Platform.OS === "web") button.current?.focus();
  }, [draft]);

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
    if (save && text !== null && clean(text).trim() !== value.trim()) onCommit(clean(text));
  };
  const edit = (text: string) => {
    // A touch keyboard's return in a one-line field arrives as a line break: it means "done".
    if (!multiline && /[\r\n]/.test(text)) {
      live.current = text;
      return stop(true);
    }
    live.current = text;
    setDraft(text);
  };

  if (draft !== null) {
    const display = size === "display-xl";
    const face = display ? "font-display text-display-xl text-ink" : size === "body" ? "font-body text-body text-ink" : "font-body text-body-sm text-ink";
    const field = (
      <TextInput
        value={draft}
        onChangeText={edit}
        onBlur={() => stop(true)}
        onSubmitEditing={
          multiline
            ? undefined
            : () => {
                refocus.current = true;
                stop(true);
              }
        }
        onKeyPress={(e) => {
          if (Platform.OS !== "web") return;
          const key = e.nativeEvent.key;
          // Escape is a web/hardware-keyboard key; on a touch keyboard, clearing the change by hand is the cancel.
          if (key === "Escape") {
            refocus.current = true;
            stop(false);
          }
          // don't touch / a multiline field on web is a <textarea>, where Enter inserts a line break before any submit
          // handler runs (seen 2026-11-18: the name became "…\n" and the field stayed open). Stop the key, then save.
          // Free text (notes) wants that line break, so it is left alone there.
          else if (!multiline && key === "Enter" && !("shiftKey" in e.nativeEvent && e.nativeEvent.shiftKey === true)) {
            e.preventDefault();
            refocus.current = true;
            stop(true);
          }
        }}
        autoFocus
        // Selecting a whole note on focus would let the first key wipe it; a name is usually replaced, a note added to.
        selectTextOnFocus={!multiline}
        // The name is multiline only so a long name wraps exactly as it does at rest; Enter still saves (above, and on
        // native via submitBehavior), it never adds a line. Notes are real multiline text.
        multiline={display || multiline}
        submitBehavior={multiline ? "newline" : "blurAndSubmit"}
        returnKeyType={multiline ? "default" : "done"}
        maxLength={maxLength}
        onContentSizeChange={multiline ? (e) => setFieldHeight(Math.max(MULTILINE_MIN, Math.ceil(e.nativeEvent.contentSize.height))) : undefined}
        accessibilityLabel={spoken(label)}
        placeholder={placeholder ?? label}
        placeholderTextColor={colors["ink-faint"]}
        className={`border-b-2 border-ink pb-1 outline-none ${face}`}
        // The 2px ink underline is the focus mark (the ring's weight); the browser's own box around a serif headline
        // would read as a form field dropped into the page.
        style={[align, display ? tracking.displayXl : null, multiline ? { height: fieldHeight, textAlignVertical: "top" } : null]}
      />
    );
    if (maxLength === undefined || counterFrom === undefined) return field;
    // don't touch / always this wrapper while a counter is possible: wrapping the field only once the counter appears
    // remounts the TextInput, whose blur then saves and closes it mid-sentence.
    return (
      <View>
        {field}
        {draft.length >= counterFrom ? (
          // Mono count at the field's end side, where a counter is expected; LTR-isolated in the text, plain words
          // for screen readers.
          <Text
            className="mt-1 font-mono text-num-sm text-ink-soft"
            style={{ alignSelf: "flex-end" }}
            accessibilityLabel={t("item.notes.counter", { n: draft.length, max: maxLength })}
          >
            {ltr(`${draft.length}/${maxLength}`)}
          </Text>
        ) : null}
      </View>
    );
  }

  const name = value ? t("item.editInline", { value, field: label }) : (emptyText ?? t("item.editInline", { value: t("item.empty"), field: label }));
  // Text lines shorter than a finger get a 44 box: body-sm pulled back to its line (a row of its own), body (notes)
  // simply at least 44 high, since it is a block that may run over several lines.
  const small = size === "body-sm";
  const block = size === "body";
  const pressable = (
    <Pressable
      ref={button}
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
        ...(block ? { minHeight: layout.hit, minWidth: layout.hit, justifyContent: "center" } : null),
      }}
    >
      <View>{children}</View>
    </Pressable>
  );
  return headingLevel ? <View {...headingProps(headingLevel)}>{pressable}</View> : pressable;
}
