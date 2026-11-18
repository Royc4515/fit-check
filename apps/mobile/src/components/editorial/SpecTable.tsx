import type { ReactNode } from "react";
import { Text, View } from "react-native";
import { Meta } from "../ui";

export type SpecRow = { key?: string; label: string; value: ReactNode };

/** Rows tall enough for a 36 chip with 8 above and below, so chip rows and text rows share one rhythm. */
const ROW_MIN_HEIGHT = 52;

/**
 * Label / value rows on hairlines: an item's tags read as a spec sheet (SSENSE, Kith: attributes as lines, not
 * fills), not as a run-on line of words. The label is `meta` at the start; the value is text or the screen's own
 * controls (chips), start-aligned in the rest of the line and free to wrap.
 */
export function SpecTable({ rows }: { rows: SpecRow[] }) {
  return (
    <View className="border-t border-hairline">
      {rows.map((r) => (
        <View key={r.key ?? r.label} className="flex-row items-center border-b border-hairline py-2" style={{ gap: 16, minHeight: ROW_MIN_HEIGHT }}>
          <View style={{ width: "28%" }}>
            <Meta>{r.label}</Meta>
          </View>
          {/* Start-aligned box, not text alignment: digit-only values are dir="auto" on web (see Tile caption). */}
          <View style={{ flex: 1, alignItems: "flex-start" }}>
            {typeof r.value === "string" ? <Text className="font-body text-body text-ink">{r.value}</Text> : r.value}
          </View>
        </View>
      ))}
    </View>
  );
}
