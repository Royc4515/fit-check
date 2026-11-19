import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, View } from "react-native";
import { Button, Chip, EditField, StatusLine } from "../../components/ui";
import { headingProps, useTypeTracking, type HeadingLevel } from "../../components/ui/Type";
import { spoken } from "./a11y";
import type { Writing } from "./useTextWriting";
import { canSave, type TextField } from "./writing";

type Props = {
  field: TextField;
  /** The stored value (what the text shows at rest). */
  value: string;
  writing: Writing;
  /** What the text is ("Item name"): the field's spoken name while writing. */
  label: string;
  /** The pencil's spoken name ("עריכת שם"). */
  editLabel: string;
  /** Shown as a dashed chip when the value is empty ("הוסף מותג"); without it an empty value shows `children`. */
  emptyText?: string;
  /** The text at rest. Tapping it also starts writing. */
  children: ReactNode;
  /** The typography of the field while writing, matching the text at rest. */
  size: "display-xl" | "body" | "body-sm";
  /**
   * The text is a heading (the item's name): at rest the text sits inside a heading of this level. While writing
   * there is no heading (a heading that wraps a field is announced as one). Put the text in `children` with
   * `Display level={null}`, so it is not a second heading.
   */
  headingLevel?: HeadingLevel;
  /** Free text over several lines (the notes): Enter is a new line, Ctrl/Cmd+Enter saves. */
  multiline?: boolean;
  maxLength?: number;
  counterFrom?: number;
  placeholder?: string;
  /** The pencil is drawn elsewhere (the notes: at the end of their heading row, `NotesPencil`). */
  pencilElsewhere?: boolean;
};

const FACE = {
  "display-xl": "font-display text-display-xl text-ink",
  body: "font-body text-body text-ink",
  "body-sm": "font-body text-body-sm text-ink",
} as const;

/**
 * Writing in place (DESIGN.md section 4, "כתיבה במקום"). At rest: the text, with a pencil button at the end of its
 * line (the keyboard and screen-reader route; tapping the text is a pointer shortcut), or a dashed "add" chip when
 * empty. Writing: `EditField` with "שמירה" and "ביטול". Under both, the field's line: "נשמר" for two seconds after a
 * save, or why the last save failed with a retry. State lives in `useTextWriting`, so only one field is open.
 */
export function InlineText({
  field,
  value,
  writing,
  label,
  editLabel,
  emptyText,
  children,
  size,
  headingLevel,
  multiline = false,
  maxLength,
  counterFrom,
  placeholder,
  pencilElsewhere = false,
}: Props) {
  const { t } = useTranslation();
  const tracking = useTypeTracking();
  const open = writing.open?.field === field ? writing.open : null;
  const status = writing.status?.field === field ? writing.status : null;
  const begin = () => writing.start(field, value);

  let body: ReactNode;
  if (open) {
    body = (
      <EditField
        value={open.draft}
        onChangeText={writing.setDraft}
        onSave={writing.submit}
        onCancel={writing.cancel}
        canSave={canSave(open)}
        multiline={multiline}
        wrap={size === "display-xl"}
        maxLength={maxLength}
        counterFrom={counterFrom}
        counterLabel={(n, max) => t("item.notes.counter", { n, max })}
        accessibilityLabel={spoken(label)}
        placeholder={placeholder ?? label}
        textClassName={FACE[size]}
        textStyle={size === "display-xl" ? tracking.displayXl : undefined}
        autoFocus={!writing.quietOpen}
      />
    );
  } else if (!value && emptyText) {
    body = (
      <View ref={writing.pencilRef(field)} style={{ alignSelf: "flex-start" }}>
        <Chip label={emptyText} dashed onPress={begin} />
      </View>
    );
  } else {
    // Tapping the text opens writing too, but it is not a second button: the pencil is the one stop for keyboards and
    // screen readers, and the text stays plain (heading) text for them.
    const text = (
      <Pressable onPress={begin} focusable={false} accessible={false} style={{ flexShrink: 1, flexGrow: 1 }}>
        {children}
      </Pressable>
    );
    body = (
      <View className="flex-row items-start" style={{ gap: 8 }}>
        {headingLevel ? (
          <View {...headingProps(headingLevel)} style={{ flexShrink: 1, flexGrow: 1 }}>
            {text}
          </View>
        ) : (
          text
        )}
        {pencilElsewhere ? null : (
          // The pencil sits at the end edge of the line, on the text's first line (DESIGN.md: 20, ink-soft, 44 box).
          <View ref={writing.pencilRef(field)}>
            <Button variant="icon" icon="edit" iconSize={20} accessibilityLabel={editLabel} onPress={begin} />
          </View>
        )}
      </View>
    );
  }

  return (
    <View>
      {body}
      {/* Always there, so a screen reader hears "נשמר" when it appears (a live region added with its text is often
          missed). The error line is an alert of its own (StatusLine). Never takes focus. */}
      <View accessibilityLiveRegion="polite">
        {status?.kind === "saved" ? (
          <View className="mt-2">
            <StatusLine variant="ok" message={t("item.writing.saved")} />
          </View>
        ) : status?.kind === "failed" ? (
          <View className="mt-2">
            <StatusLine variant="error" message={status.message} action={{ label: t("item.writing.retry"), onPress: writing.retry }} />
          </View>
        ) : null}
      </View>
    </View>
  );
}

/** The notes' pencil, at the end of their heading row (DESIGN.md section 4): only when there is a note to edit. */
export function NotesPencil({ writing, value, label }: { writing: Writing; value: string; label: string }) {
  if (!value || writing.open?.field === "notes") return null;
  return (
    <View ref={writing.pencilRef("notes")}>
      <Button variant="icon" icon="edit" iconSize={20} accessibilityLabel={label} onPress={() => writing.start("notes", value)} />
    </View>
  );
}
