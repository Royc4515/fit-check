import { useTranslation } from "react-i18next";
import { ScrollView, Text, View } from "react-native";
import { Swatch } from "../../components/ui";
import { layout } from "../../theme/tokens";

type Props = {
  swatches: readonly { name: string; hex: string }[];
  /** The chosen colour name, if any. */
  selected: string | undefined;
  onToggle: (name: string) => void;
  /** Start padding of the scrolling row, to line the first swatch up with the screen's gutter. */
  inset: number;
};

// A swatch is 32 with its ring space; 12 between them makes each one a whole 44 target without overlapping slop.
const SWATCH_GAP = 12;

/**
 * The colour filter as a row of 24px swatches (DESIGN.md section 3 "ארון" item 3). Tap selects, tap again clears.
 * The chosen colour's name is written at the row's end: the ring alone would be meaning by colour only. The name
 * sits outside the scrolling part, so it stays readable however far the row is scrolled.
 */
export function SwatchRow({ swatches, selected, onToggle, inset }: Props) {
  const { t } = useTranslation();
  if (swatches.length === 0) return null;
  const selectedName = selected ? t(`wardrobe.color.${selected}`) : null;
  return (
    <View className="flex-row items-center" style={{ minHeight: layout.hit }}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        accessibilityLabel={t("wardrobe.colors")}
        contentContainerStyle={{ paddingStart: inset, paddingEnd: selectedName ? 12 : inset, gap: SWATCH_GAP, alignItems: "center" }}
        style={{ flexGrow: 1, flexShrink: 1 }}
      >
        {swatches.map((s) => (
          <Swatch
            key={s.name}
            color={s.hex}
            selected={s.name === selected}
            accessibilityLabel={t(`wardrobe.color.${s.name}`)}
            onPress={() => onToggle(s.name)}
          />
        ))}
      </ScrollView>
      {selectedName ? (
        // A hairline at its start separates the name from the swatches that scroll under it.
        <View className="border-s border-hairline ps-3" style={{ paddingEnd: inset }} accessibilityLiveRegion="polite">
          <Text className="font-body text-body-sm text-ink" numberOfLines={1} accessibilityLabel={t("wardrobe.colorSelected", { color: selectedName })}>
            {selectedName}
          </Text>
        </View>
      ) : null}
    </View>
  );
}
