import { Text, View } from "react-native";
import { layout } from "../../theme/tokens";
import { Button } from "./Button";
import { Icon, type IconName } from "./Icon";

export type StatusVariant = "info" | "ok" | "error";

const LOOK = {
  info: { icon: "info", iconColor: "ink-soft", text: "text-ink-soft" },
  ok: { icon: "check_circle", iconColor: "ok", text: "text-ink" },
  // Warn, not a red: DESIGN.md has no red token, and the icon carries the meaning for colour-blind readers.
  error: { icon: "error", iconColor: "warn", text: "text-warn" },
} as const satisfies Record<StatusVariant, { icon: IconName; iconColor: "ink-soft" | "ok" | "warn"; text: string }>;

/** `accessibilityLabel`: a fuller name when the visible word alone is ambiguous ("Cancel" -> "Cancel the occasion"). */
type Action = { label: string; onPress: () => void; accessibilityLabel?: string };

type Props = {
  variant?: StatusVariant;
  message: string;
  /** One recovery or follow-up action, e.g. "retry" or "undo". */
  action?: Action;
  /**
   * A second, different answer to the same message (Today's skip: "didn't like it" beside "undo"). With it, both
   * actions move to their own row under the message, aligned with the text: two of them never fit beside it.
   */
  secondaryAction?: Action;
  /**
   * Further answers after the two (the wardrobe's reserve-duty line: "back, to the laundry", "back, clean", "add
   * more"). Only shown together with `action` and `secondaryAction`, on the same second row.
   */
  moreActions?: readonly Action[];
  /** A write is in flight: the actions are inert, the message stays readable. */
  disabled?: boolean;
};

const ICON = 20;
const GAP = 8;

/**
 * One-line status (saved, failed, offline): icon + text + optional text action. Each variant has its own glyph so
 * the meaning never rests on colour (DESIGN.md section 1). Errors are announced as alerts; the rest politely.
 */
export function StatusLine({ variant = "info", message, action, secondaryAction, moreActions, disabled = false }: Props) {
  const look = LOOK[variant];
  const a11y = {
    accessibilityRole: variant === "error" ? ("alert" as const) : undefined,
    accessibilityLiveRegion: variant === "error" ? ("assertive" as const) : ("polite" as const),
  };
  const line = (
    <View className="flex-row items-center" style={{ gap: GAP, minHeight: layout.hit }}>
      <Icon name={look.icon} color={look.iconColor} />
      <Text className={`flex-1 font-body text-body-sm ${look.text}`}>{message}</Text>
      {action && !secondaryAction ? (
        <Button variant="text" label={action.label} accessibilityLabel={action.accessibilityLabel} onPress={action.onPress} disabled={disabled} />
      ) : null}
    </View>
  );
  if (!action || !secondaryAction) return <View {...a11y}>{line}</View>;
  return (
    <View {...a11y}>
      {line}
      <View className="flex-row flex-wrap" style={{ paddingStart: ICON + GAP, columnGap: 24 }}>
        <Button variant="text" label={action.label} accessibilityLabel={action.accessibilityLabel} onPress={action.onPress} disabled={disabled} />
        <Button variant="text" label={secondaryAction.label} accessibilityLabel={secondaryAction.accessibilityLabel} onPress={secondaryAction.onPress} disabled={disabled} />
        {moreActions?.map((a) => <Button key={a.label} variant="text" label={a.label} onPress={a.onPress} disabled={disabled} />)}
      </View>
    </View>
  );
}
