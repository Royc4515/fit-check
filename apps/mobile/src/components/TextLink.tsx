import { Link, type Href } from "expo-router";
import { Text, View } from "react-native";

/**
 * Secondary action per DESIGN.md section 2: ink text with a hairline underline 4px below. The underline is a
 * bordered wrapper because RN cannot offset or color text-decoration.
 */
export function TextLink({ href, label }: { href: Href; label: string }) {
  return (
    <Link href={href} accessibilityRole="link">
      <View className="border-b border-hairline pb-1">
        <Text className="font-body text-body-sm text-ink">{label}</Text>
      </View>
    </Link>
  );
}
