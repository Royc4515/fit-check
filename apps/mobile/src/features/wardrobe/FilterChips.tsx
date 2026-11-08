import { Fragment } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, ScrollView, Text, View } from "react-native";
import { layout } from "../../theme/tokens";
import type { Facet, Selection } from "./filters";

type Props = {
  facets: Array<{ facet: Facet; values: string[] }>;
  selection: Selection;
  onToggle: (facet: Facet, value: string) => void;
  onClear: () => void;
};

function Chip({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      hitSlop={6}
      // Selected = ink fill with ivory text (DESIGN.md section 3). Never the accent: accent is one action per screen.
      className={`justify-center rounded border px-3 ${selected ? "border-ink bg-ink" : "border-hairline"}`}
      style={{ minHeight: 36 }}
    >
      <Text className={`font-body text-body-sm ${selected ? "text-ivory" : "text-ink-soft"}`}>{label}</Text>
    </Pressable>
  );
}

/** One horizontally scrolling row; facets are separated by a hairline, not by new rows (DESIGN.md section 3). */
export function FilterChips({ facets, selection, onToggle, onClear }: Props) {
  const { t } = useTranslation();
  const anySelected = Object.values(selection).some((v) => v !== undefined);

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{ alignItems: "center", gap: 8, paddingHorizontal: layout.gutter }}
    >
      <Chip label={t("wardrobe.all")} selected={!anySelected} onPress={onClear} />
      {facets.map(({ facet, values }) => (
        <Fragment key={facet}>
          <View className="bg-hairline" style={{ width: 1, height: 20 }} />
          {values.map((value) => (
            <Chip
              key={value}
              label={t(`wardrobe.${facet}.${value}`)}
              selected={selection[facet] === value}
              onPress={() => onToggle(facet, value)}
            />
          ))}
        </Fragment>
      ))}
    </ScrollView>
  );
}
