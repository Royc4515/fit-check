import { Text, View } from "react-native";
import { Button } from "./Button";
import { Display } from "./Type";

type Props = {
  title: string;
  body: string;
  /** The one thing that fixes the emptiness. Ink, not accent: the screen's accent belongs to its main action. */
  action?: { label: string; onPress: () => void };
};

/**
 * Designed empty state (DESIGN.md section 4): a display heading, one body line, at most one action. Start-aligned
 * like the rest of the editorial layout, never centred hero-style (section 1).
 */
export function EmptyState({ title, body, action }: Props) {
  return (
    <View className="py-12">
      <Display accessibilityRole="header">{title}</Display>
      <Text className="mt-3 font-body text-body text-ink-soft">{body}</Text>
      {action ? (
        <View className="mt-6">
          <Button variant="ink" label={action.label} onPress={action.onPress} />
        </View>
      ) : null}
    </View>
  );
}
