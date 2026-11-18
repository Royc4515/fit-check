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

type Props = {
  variant?: StatusVariant;
  message: string;
  /** One recovery or follow-up action, e.g. "retry" or "undo". */
  action?: { label: string; onPress: () => void };
};

/**
 * One-line status (saved, failed, offline): icon + text + optional text action. Each variant has its own glyph so
 * the meaning never rests on colour (DESIGN.md section 1). Errors are announced as alerts; the rest politely.
 */
export function StatusLine({ variant = "info", message, action }: Props) {
  const look = LOOK[variant];
  return (
    <View
      accessibilityRole={variant === "error" ? "alert" : undefined}
      accessibilityLiveRegion={variant === "error" ? "assertive" : "polite"}
      className="flex-row items-center"
      style={{ gap: 8, minHeight: layout.hit }}
    >
      <Icon name={look.icon} color={look.iconColor} />
      <Text className={`flex-1 font-body text-body-sm ${look.text}`}>{message}</Text>
      {action ? <Button variant="text" label={action.label} onPress={action.onPress} /> : null}
    </View>
  );
}
