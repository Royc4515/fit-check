import { Text, View } from "react-native";

/**
 * The FC monogram: Frank Ruhl Libre inside a hairline square, the same mark as the app icon and splash
 * (assets/icon.png). Ink on ivory only; it is a signature, not decoration, so it appears once per screen at most.
 */
export function Monogram({ size = 44 }: { size?: number }) {
  return (
    <View
      accessibilityRole="image"
      accessibilityLabel="Fit Check"
      className="items-center justify-center border-ink"
      style={{ width: size, height: size, borderWidth: Math.max(1, size / 44) }}
    >
      <Text className="font-display text-ink" style={{ fontSize: size * 0.4, lineHeight: size * 0.48, letterSpacing: -0.3 }}>
        FC
      </Text>
    </View>
  );
}
