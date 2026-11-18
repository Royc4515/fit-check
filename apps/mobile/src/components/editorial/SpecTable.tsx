import type { ReactNode } from "react";
import { Text, View } from "react-native";

export type SpecRow = { label: string; value: ReactNode };

/** Label / value rows on hairlines: an item's tags read as a spec sheet, not as a run-on line of words. */
export function SpecTable({ rows }: { rows: SpecRow[] }) {
  return (
    <View className="border-t border-hairline">
      {rows.map((r) => (
        <View key={r.label} className="flex-row items-baseline border-b border-hairline py-3" style={{ gap: 16 }}>
          <Text className="font-body text-body-sm text-ink-faint" style={{ width: "34%" }}>
            {r.label}
          </Text>
          {/* Start-aligned box, not text alignment: digit-only values are dir="auto" on web (see Tile caption). */}
          <View style={{ flex: 1, alignItems: "flex-start" }}>{typeof r.value === "string" ? <Text className="font-body text-body text-ink">{r.value}</Text> : r.value}</View>
        </View>
      ))}
    </View>
  );
}
