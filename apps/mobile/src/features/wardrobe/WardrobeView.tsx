import type { Item } from "@fit-check/schema";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ScrollView, Text, View, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { TextLink } from "../../components/TextLink";
import { FilterChips } from "./FilterChips";
import { applyFilters, deriveFacets, type Facet, type Selection } from "./filters";
import { WardrobeGrid } from "./WardrobeGrid";
import { layout } from "../../theme/tokens";

// DESIGN.md section 3: web is the same screen, capped at 1120 with five columns.
const WIDE_BREAKPOINT = 900;
const MAX_WIDTH = 1120;

/** "Wardrobe" view (DESIGN.md section 3). Pure presentation; app/wardrobe.tsx supplies the items. */
export function WardrobeView({ all }: { all: Item[] }) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const [selection, setSelection] = useState<Selection>({});

  const facets = useMemo(() => deriveFacets(all), [all]);
  const visible = useMemo(() => applyFilters(all, selection), [all, selection]);
  const columns = width >= WIDE_BREAKPOINT ? 5 : 3;
  const groupCount = useMemo(() => new Set(visible.map((i) => i.tags.category)).size, [visible]);

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
          {/* A sentence, not a bare number: "108" alone read as a stray value. Numbers stay LTR inside Hebrew. */}
          <Text className="mt-2 font-body text-body-sm text-ink-soft">
            {t("wardrobe.summary", { items: `\u2066${visible.length}\u2069`, groups: `\u2066${groupCount}\u2069` })}
          </Text>
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
