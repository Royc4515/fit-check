import { Pressable, Text, View } from "react-native";
import { colors, layout } from "../../theme/tokens";
import { focusRingProps } from "./interaction";

type Props = {
  /** "01".."04": ties the row to the number beside its garment in a composition. */
  index: string;
  /** What it is ("polo"), body-sm ink. */
  title: string;
  /** Which one ("Benetton Polo"), body-sm ink-faint, one line. */
  detail: string;
  onPress?: () => void;
  accessibilityLabel?: string;
};

/**
 * One line of a numbered legend under a composition, magazine-style: `01  פולו  Benetton Polo` on a hairline.
 * Everything start-aligned, the detail takes the rest of the line and truncates. Pressable rows get the ListRow
 * wash (no scale: a full-width row shrinking reads as the page jumping). Min 44 high.
 */
export function LegendRow({ index, title, detail, onPress, accessibilityLabel }: Props) {
  const content = (
    <View className="flex-row items-baseline border-b border-hairline py-3" style={{ minHeight: layout.hit, gap: 12 }}>
      <Text className="font-mono text-num-sm text-ink-soft">{index}</Text>
      <Text className="font-body text-body-sm text-ink">{title}</Text>
      {/* don't touch / start-aligned box, not text alignment: react-native-web gives text dir="auto", so a Latin
          name inside an RTL row would hug the far edge (see Tile caption). */}
      <View style={{ flex: 1, alignItems: "flex-start" }}>
        <Text className="font-body text-body-sm text-ink-faint" numberOfLines={1} style={{ maxWidth: "100%" }}>
          {detail}
        </Text>
      </View>
    </View>
  );
  if (!onPress) return content;
  return (
    <Pressable
      {...focusRingProps}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? `${index} ${title} ${detail}`}
      style={({ pressed }) => ({ backgroundColor: pressed ? colors["ivory-deep"] : undefined })}
    >
      {content}
    </Pressable>
  );
}
