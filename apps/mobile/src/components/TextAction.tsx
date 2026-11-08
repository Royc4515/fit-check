import { Pressable, Text, View } from "react-native";

/**
 * TextLink's look (DESIGN.md section 2 secondary action) for an action instead of a route. `quiet` drops the
 * text to ink-soft for actions that should not compete with the content (undo, reset).
 */
export function TextAction({ label, onPress, disabled, quiet }: { label: string; onPress: () => void; disabled?: boolean; quiet?: boolean }) {
  return (
    <Pressable onPress={onPress} disabled={disabled} accessibilityRole="button" accessibilityState={{ disabled }} hitSlop={8}>
      <View className="border-b border-hairline pb-1" style={{ opacity: disabled ? 0.4 : 1 }}>
        <Text className={`font-body text-body-sm ${quiet ? "text-ink-soft" : "text-ink"}`}>{label}</Text>
      </View>
    </Pressable>
  );
}
