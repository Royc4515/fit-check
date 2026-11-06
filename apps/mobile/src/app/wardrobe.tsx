import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ScrollView, Text, View, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { TextLink } from "../components/TextLink";
import { FilterChips } from "../features/wardrobe/FilterChips";
import { applyFilters, deriveFacets, type Facet, type Selection } from "../features/wardrobe/filters";
import { WardrobeGrid } from "../features/wardrobe/WardrobeGrid";
import { MOCK_WARDROBE } from "../mock/wardrobe";
import { layout } from "../theme/tokens";

// DESIGN.md section 3: web is the same screen, capped at 1120 with five columns.
const WIDE_BREAKPOINT = 900;
const MAX_WIDTH = 1120;

/** "Wardrobe" (DESIGN.md section 3). Mock data; filters are local state, which is fine: only data changes, animation is on the UI thread. */
export default function Wardrobe() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const [selection, setSelection] = useState<Selection>({});

  const facets = useMemo(() => deriveFacets(MOCK_WARDROBE), []);
  const visible = useMemo(() => applyFilters(MOCK_WARDROBE, selection), [selection]);
  const columns = width >= WIDE_BREAKPOINT ? 5 : 3;

  const toggle = (facet: Facet, value: string) =>
    setSelection((prev) => ({ ...prev, [facet]: prev[facet] === value ? undefined : value }));

  return (
    <View className="flex-1 bg-ivory">
      <ScrollView
        contentContainerStyle={{
          width: "100%",
          maxWidth: MAX_WIDTH,
          alignSelf: "center",
          paddingTop: insets.top + 32,
          paddingBottom: insets.bottom + 64,
        }}
      >
        <View style={{ paddingHorizontal: layout.gutter }}>
          <View className="flex-row items-baseline justify-between">
            <Text className="font-display text-display-xl text-ink">{t("wardrobe.title")}</Text>
            <TextLink href="/" label={t("nav.today")} />
          </View>
          <Text className="mt-2 font-mono text-num text-ink-soft">{visible.length}</Text>
        </View>
        <View className="mt-6">
          <FilterChips
            facets={facets}
            selection={selection}
            onToggle={toggle}
            onClear={() => setSelection({})}
          />
        </View>
        <View className="mt-8" style={{ paddingHorizontal: layout.gutter }}>
          <WardrobeGrid items={visible} columns={columns} />
        </View>
      </ScrollView>
    </View>
  );
}
