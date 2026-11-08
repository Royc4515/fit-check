import type { Availability, Item } from "@fit-check/schema";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ScrollView, Text, View, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { TextAction } from "../../components/TextAction";
import { TextLink } from "../../components/TextLink";
import { FilterChips } from "./FilterChips";
import { applyFilters, deriveFacets, isReserveItem, type Facet, type Selection } from "./filters";
import { WardrobeGrid } from "./WardrobeGrid";
import { layout } from "../../theme/tokens";

// DESIGN.md section 3: web is the same screen, capped at 1120 with five columns.
const WIDE_BREAKPOINT = 900;
const MAX_WIDTH = 1120;

const ltr = (s: string | number) => `\u2066${s}\u2069`;

/**
 * "Wardrobe" view (DESIGN.md section 3). Pure presentation; app/wardrobe.tsx supplies the items and `onMove`.
 *
 * Reserve duty (PRD 4): "יוצא למילואים" turns the grid into a picker; the picked items become `away` and are never
 * suggested. While anything is away, the header says so and offers "חזרתי", which sends everything that was away to
 * the laundry (the usual case after a weekend on base) or straight home.
 */
export function WardrobeView({ all, onMove }: { all: Item[]; onMove?: (ids: string[], next: Availability) => Promise<void> }) {
  const { t } = useTranslation();
  const [packing, setPacking] = useState(false);
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [packAll, setPackAll] = useState(false);
  const [failed, setFailed] = useState(false);
  const away = useMemo(() => all.filter((i) => i.availability === "away").map((i) => i.id), [all]);

  const run = (ids: string[], next: Availability, after?: () => void) => {
    if (!onMove || ids.length === 0) return;
    setBusy(true);
    setFailed(false);
    onMove(ids, next)
      .then(after)
      .catch((error: unknown) => {
        console.error("Availability move failed", error);
        setFailed(true);
      })
      .finally(() => setBusy(false));
  };
  const togglePick = (id: string) =>
    setPicked((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const stopPacking = () => {
    setPacking(false);
    setPackAll(false);
    setPicked(new Set());
  };
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const [selection, setSelection] = useState<Selection>({});

  const facets = useMemo(() => deriveFacets(all), [all]);
  const visible = useMemo(() => {
    const filtered = applyFilters(all, selection);
    return packing && !packAll ? filtered.filter(isReserveItem) : filtered;
  }, [all, selection, packing, packAll]);
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
            <View className="flex-row items-baseline" style={{ gap: 20 }}>
              <TextLink href="/intake" label={t("nav.addClothes")} />
              <TextLink href="/" label={t("nav.today")} />
            </View>
          </View>
          {/* A sentence, not a bare number: "108" alone read as a stray value. Numbers stay LTR inside Hebrew. */}
          <Text className="mt-2 font-body text-body-sm text-ink-soft">
            {t("wardrobe.summary", { items: `\u2066${visible.length}\u2069`, groups: `\u2066${groupCount}\u2069` })}
          </Text>
          {onMove ? (
            <View className="mt-4" style={{ gap: 10 }}>
              {packing ? (
                <>
                  <Text className="font-body text-body-sm text-ink-soft">
                    {picked.size > 0 ? t("wardrobe.reserve.picked", { count: picked.size, n: ltr(picked.size) }) : t("wardrobe.reserve.pickHint")}
                  </Text>
                  <Text className="font-body text-body-sm text-ink-soft">{t("wardrobe.reserve.notInWardrobe")}</Text>
                  <View className="flex-row flex-wrap" style={{ columnGap: 16, rowGap: 8 }}>
                    <TextAction
                      label={t("wardrobe.reserve.confirm")}
                      disabled={busy || picked.size === 0}
                      onPress={() => run([...picked], "away", stopPacking)}
                    />
                    <TextAction
                      label={packAll ? t("wardrobe.reserve.showUsual") : t("wardrobe.reserve.showAll")}
                      quiet
                      onPress={() => setPackAll((v) => !v)}
                    />
                    <TextAction label={t("wardrobe.reserve.cancel")} quiet disabled={busy} onPress={stopPacking} />
                  </View>
                </>
              ) : away.length > 0 ? (
                <>
                  <Text className="font-body text-body-sm text-ink-soft">{t("wardrobe.reserve.away", { count: away.length, n: ltr(away.length) })}</Text>
                  <View className="flex-row flex-wrap" style={{ columnGap: 16, rowGap: 8 }}>
                    <TextAction label={t("wardrobe.reserve.backLaundry")} disabled={busy} onPress={() => run(away, "laundry")} />
                    <TextAction label={t("wardrobe.reserve.backHome")} quiet disabled={busy} onPress={() => run(away, "home")} />
                    <TextAction label={t("wardrobe.reserve.packMore")} quiet disabled={busy} onPress={() => setPacking(true)} />
                  </View>
                </>
              ) : (
                <View className="self-start">
                  <TextAction label={t("wardrobe.reserve.start")} onPress={() => setPacking(true)} />
                </View>
              )}
              {failed ? <Text className="font-body text-body-sm text-ink-soft">{t("wardrobe.reserve.failed")}</Text> : null}
            </View>
          ) : null}
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
          <WardrobeGrid items={visible} columns={columns} picking={packing ? { picked, toggle: togglePick } : undefined} />
        </View>
      </ScrollView>
    </View>
  );
}
