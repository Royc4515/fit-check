import { useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Platform, Pressable, TextInput, View } from "react-native";
import { focusRingProps } from "../../components/ui";
import { useTypeTracking } from "../../components/ui/Type";
import { colors } from "../../theme/tokens";

type Props = {
  value: string;
  /** What the text is ("Item name"), for the field's label and the button's spoken name. */
  label: string;
  /** Saves a changed value. The text shows the stored value, so a failed save simply shows the old one again. */
  onCommit: (next: string) => void;
  /** The text at rest; pressing it starts editing. */
  children: ReactNode;
  /** The typography of the field while editing, matching the text at rest so nothing jumps. */
  size: "display-xl" | "body-sm";
  disabled?: boolean;
};

/**
 * Edit in place (DESIGN.md section 3 "פריט" item 2): the text is a button; pressing it swaps in a field in the same
 * face and size, focused. Blur or the return key saves, Escape (web) cancels. Nothing is saved when nothing changed.
 */
export function InlineText({ value, label, onCommit, children, size, disabled = false }: Props) {
  const { t, i18n } = useTranslation();
  const tracking = useTypeTracking();
  const [draft, setDraft] = useState<string | null>(null);
  // Hebrew is right-aligned, English left; the field does not inherit the page direction on web.
  const align = { textAlign: i18n.language === "en" ? "left" : "right" } as const;

  // don't touch / a ref, not the state: Escape unmounts the field, and the blur that unmounting fires still sees the
  // old render's draft, which would save the text the user just cancelled.
  const live = useRef<string | null>(null);
  const start = () => {
    live.current = value;
    setDraft(value);
  };
  const edit = (text: string) => {
    live.current = text;
    setDraft(text);
  };
  const stop = (save: boolean) => {
    const text = live.current;
    live.current = null;
    setDraft(null);
    if (save && text !== null && text.trim() !== value.trim()) onCommit(text);
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
          // Escape is a web/hardware-keyboard key; on a touch keyboard, clearing the change by hand is the cancel.
          if (Platform.OS === "web" && e.nativeEvent.key === "Escape") stop(false);
        }}
        autoFocus
        selectTextOnFocus
        // Multiline so a long name wraps exactly as it does at rest; return still saves instead of adding a line.
        multiline={display}
        submitBehavior="blurAndSubmit"
        returnKeyType="done"
        accessibilityLabel={label}
        placeholder={label}
        placeholderTextColor={colors["ink-faint"]}
        className={`border-b-2 border-ink pb-1 outline-none ${display ? "font-display text-display-xl text-ink" : "font-body text-body-sm text-ink"}`}
        // The 2px ink underline is the focus mark (the ring's weight); the browser's own box around a serif headline
        // would read as a form field dropped into the page.
        style={[align, display ? tracking.displayXl : null]}
      />
    );
  }

  return (
    <Pressable
      {...focusRingProps}
      onPress={start}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={t("item.editField", { field: label, value: value || t("item.empty") })}
      // Start-aligned box: the text inside sizes to its content and stays on the reading side (Tile caption note).
      style={{ alignSelf: "flex-start", maxWidth: "100%" }}
    >
      <View>{children}</View>
    </Pressable>
  );
}
