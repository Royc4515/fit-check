import { Text, View } from "react-native";

export type DataCell = { label: string; value: string; /** Numbers set in mono; words (Hebrew) never are. */ mono?: boolean };

/**
 * Facts as a hairline table of equal cells, magazine-style: small label over value. Replaces a sentence of
 * numbers, which is harder to scan and mixed Hebrew into the mono face (Plex Mono has no Hebrew glyphs).
 */
export function DataStrip({ cells }: { cells: DataCell[] }) {
  return (
    <View className="flex-row border-y border-hairline">
      {cells.map((c, i) => (
        <View key={c.label} className={`flex-1 py-3 ${i > 0 ? "border-s border-hairline ps-3" : ""}`}>
          <Text className="font-body text-meta text-ink-faint">{c.label}</Text>
          {/* don't touch / the wrapper aligns, not the Text: react-native-web gives text dir="auto", so a value with
              only digits is treated as LTR and hugged the left edge of an RTL cell. A start-aligned box follows the
              layout direction on every platform. */}
          <View className="mt-1" style={{ alignItems: "flex-start" }}>
            <Text className={`${c.mono ? "font-mono text-num" : "font-body text-body"} text-ink`} numberOfLines={1}>
              {c.value}
            </Text>
          </View>
        </View>
      ))}
    </View>
  );
}
