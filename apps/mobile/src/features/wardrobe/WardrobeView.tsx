import type { Availability, Item } from "@fit-check/schema";
import { useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState, type ComponentRef } from "react";
import { useTranslation } from "react-i18next";
import { ScrollView, Text, View, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  ActionBar,
  Button,
  Chip,
  Display,
  EmptyState,
  MasonryGrid,
  ScreenHeader,
  Segmented,
  StatusLine,
  TextTabs,
  Tile,
  TILE_CAPTION_HEIGHT,
  type MasonrySection,
  type TextTab,
} from "../../components/ui";
import { tileAspect } from "../../theme/tileTone";
import { layout, masonryColumnsFor } from "../../theme/tokens";
import { measureCell, registerCell, setOrigin } from "../item/transition";
import { FilterSheet } from "./FilterSheet";
import {
  applyFilters,
  byName,
  CATEGORY_TABS,
  deriveFacets,
  groupByCategory,
  inScope,
  isReserveItem,
  listed,
  presentCategories,
  SHEET_FACETS,
  swatchesOf,
  type CategoryScope,
  type SheetFacet,
  type Selection,
} from "./filters";
import { ItemActionsSheet } from "./ItemActionsSheet";
import { SwatchRow } from "./SwatchRow";

const ltr = (s: string | number) => `⁦${s}⁩`;

/** Section head inside the masonry: one display line (34) and 16 under it to the first tiles. */
const SECTION_HEADER_H = 34 + 16;
/** Visible gap from the last filter row (swatches or chips) to the first section heading under "all". */
const HEADING_GAP = 24;
/** Visible size of a swatch in the colour row (Swatch's default); the row around it is `layout.hit` high. */
const SWATCH_VISIBLE = 24;
/** Space kept between the last tiles and the floating bar's top edge while picking. */
const UNDER_BAR = 32;

type Props = {
  all: Item[];
  /** Bulk availability move (reserve duty); optimistic in the container, rejects when the write failed. */
  onMove?: (ids: string[], next: Availability) => Promise<void>;
  /** One item's availability (long-press sheet); optimistic in the container, rejects when the write failed. */
  onAvailability?: (id: string, next: Availability, prev: Availability) => Promise<void>;
  /** Removes an item from the wardrobe (archive); rejects when the write failed. */
  onArchive?: (id: string) => Promise<void>;
};

/**
 * "ארון" (DESIGN.md section 3). Pure presentation; app/(tabs)/wardrobe.tsx supplies the items and the writes.
 *
 * A Pinterest-style masonry of cutouts under three rows: category words (sticky), the colours present as swatches,
 * and the active sheet filters as removable chips. `tune` opens type / season / availability; a long press on a tile
 * opens its actions. Filters are single choice per facet and combine with AND.
 *
 * Reserve duty (PRD 4): the backpack turns the grid into a picker of what usually goes (or everything); the picked
 * items become `away` and are never suggested. While anything is away, a line under the header says so and offers
 * "back, to the laundry" (the usual case after a weekend on base), "back, clean" and "add more".
 */
export function WardrobeView({ all, onMove, onAvailability, onArchive }: Props) {
  const { t } = useTranslation();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width: windowW } = useWindowDimensions();
  const desktop = windowW >= layout.desktopMin;
  const contentW = Math.min(windowW, layout.maxContentWidthWide) - 2 * layout.gridGutter;
  const columns = masonryColumnsFor(windowW);
  // Rows that scroll sideways run to the screen edge on a phone; on desktop they stay inside the content column.
  const rowInset = desktop ? 0 : layout.gridGutter;
  const rowWidth = desktop ? contentW : windowW;

  const [scope, setScope] = useState<CategoryScope>("all");
  const [selection, setSelection] = useState<Selection>({});
  const [filterOpen, setFilterOpen] = useState(false);
  // The actions sheet keeps the id it was opened for, so its title does not vanish under the closing animation.
  const [actionsId, setActionsId] = useState<string | null>(null);
  const [actionsOpen, setActionsOpen] = useState(false);

  const [packing, setPacking] = useState(false);
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const [packAll, setPackAll] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [barHeight, setBarHeight] = useState(0);

  const scrollRef = useRef<ComponentRef<typeof ScrollView>>(null);
  const scrollY = useRef(0);
  const stickyY = useRef(0);

  const items = useMemo(() => listed(all), [all]);
  const away = useMemo(() => items.filter((i) => i.availability === "away").map((i) => i.id), [items]);
  const categories = useMemo(() => presentCategories(all), [all]);
  // An archived last shirt must not leave the screen on an empty, untabbable category.
  const activeScope: CategoryScope = scope !== "all" && !categories.includes(scope) ? "all" : scope;

  const base = useMemo(() => {
    const scoped = inScope(all, activeScope);
    return packing && !packAll ? scoped.filter(isReserveItem) : scoped;
  }, [all, activeScope, packing, packAll]);
  const visible = useMemo(() => applyFilters(base, selection), [base, selection]);
  const swatches = useMemo(() => swatchesOf(applyFilters(base, selection, "color"), selection.color), [base, selection]);
  const facets = useMemo(() => deriveFacets(base, SHEET_FACETS, selection), [base, selection]);
  const sheetActive = SHEET_FACETS.some((f) => selection[f] !== undefined);
  const anyFilter = sheetActive || selection.color !== undefined || activeScope !== "all";

  // A re-filter while deep in the grid would leave the reader in the middle of a different list: bring the sticky
  // row back to the top, where the new result starts. Never scrolls down, and never above the header.
  useEffect(() => {
    if (scrollY.current > stickyY.current) scrollRef.current?.scrollTo({ y: stickyY.current, animated: false });
  }, [activeScope, selection, packing, packAll]);

  const toggle = (facet: "color" | SheetFacet, value: string) =>
    setSelection((prev) => ({ ...prev, [facet]: prev[facet] === value ? undefined : value }));
  const clearSheet = () => setSelection((prev) => ({ color: prev.color }));
  const clearAll = () => {
    setSelection({});
    setScope("all");
  };
  // The row's "נקה" keeps the category: it is the screen's scope (the tab the reader chose), not a filter on it.
  const clearFilters = () => setSelection({});
  const filtersActive = sheetActive || selection.color !== undefined;

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
  const togglePick = useCallback(
    (id: string) =>
      setPicked((cur) => {
        const next = new Set(cur);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      }),
    []
  );
  const startPacking = () => {
    setFailed(false);
    setPacking(true);
  };
  const stopPacking = () => {
    // The failure line belongs to the attempt that failed; once that attempt is cancelled it would read as current.
    setFailed(false);
    setPacking(false);
    setPackAll(false);
    setPicked(new Set());
  };

  const openItem = useCallback(
    async (id: string) => {
      // Measure first, push second: the item screen needs the rect on its very first frame to start the flight
      // from exactly where the tile is. If measuring fails it just fades in, which is still correct.
      const rect = await measureCell(id);
      if (rect) setOrigin(id, rect);
      router.push({ pathname: "/item/[id]", params: { id } });
    },
    [router]
  );
  const openActions = useCallback((id: string) => {
    setActionsId(id);
    setActionsOpen(true);
  }, []);

  const typeOf = useCallback((i: Item) => t(`item.subcategory.${i.tags.subcategory}`), [t]);
  const renderItem = useCallback(
    (item: Item, { width }: { width: number }) => {
      // Not at home is shown on the tile so the grid explains why an item never comes up on Today.
      const where = item.availability === "home" ? null : t(`wardrobe.availability.${item.availability}`);
      const type = typeOf(item);
      const color = t(`wardrobe.color.${item.tags.color_name}`);
      const label = where ? t("wardrobe.tileLabelWhere", { name: item.name, type, color, where }) : t("wardrobe.tileLabel", { name: item.name, type, color });
      return (
        <Tile
          item={item}
          width={width}
          caption={{ title: item.name, meta: `${type} · ${where ?? color}` }}
          // Picking is about what to pack; dimming the away items there would hide the answer to "is it packed".
          dimmed={where !== null && !packing}
          selected={packing && picked.has(item.id)}
          toggle={packing}
          accessibilityLabel={label}
          // don't touch / the registry is how the item screen finds this tile to fly back to; measuring on press
          // goes through the same registry (measureCell), so both directions see the same box.
          imageRef={(node) => registerCell(item.id, node)}
          onPress={() => (packing ? togglePick(item.id) : void openItem(item.id))}
          onLongPress={packing ? undefined : () => openActions(item.id)}
        />
      );
    },
    [t, typeOf, packing, picked, togglePick, openItem, openActions]
  );
  const keyOf = useCallback((i: Item) => i.id, []);
  const aspectOf = useCallback((i: Item) => tileAspect(i.tags.subcategory), []);

  const sections = useMemo<MasonrySection<Item>[]>(() => {
    // One category is a continuous grid; "all" groups by category with a heading and count each (item 6).
    if (activeScope !== "all") return [{ key: activeScope, items: [...visible].sort(byName) }];
    return groupByCategory(visible, CATEGORY_TABS).map((g) => ({
      key: g.category,
      items: g.items,
      header: (
        <View className="flex-row items-baseline" style={{ gap: 8 }}>
          <Display>{t(`wardrobe.category.${g.category}`)}</Display>
          <Text className="font-mono text-num-sm text-ink-soft">{ltr(g.items.length)}</Text>
        </View>
      ),
    }));
  }, [activeScope, visible, t]);

  const tabs = useMemo<TextTab<CategoryScope>[]>(
    () => [{ key: "all", label: t("wardrobe.all") }, ...categories.map((c) => ({ key: c, label: t(`wardrobe.category.${c}`) }))],
    [categories, t]
  );

  const actionsItem = actionsId ? (all.find((i) => i.id === actionsId) ?? null) : null;
  const pickedLine = picked.size > 0 ? t("wardrobe.reserve.picked", { count: picked.size, n: ltr(picked.size) }) : t("wardrobe.reserve.pickHint");

  const header = (
    // The sticky row starts where the header ends; that is where a re-filter scrolls back to. The 8 below keeps the
    // icons' keyboard focus ring (4 outside the button) clear of the sticky row, which paints over what precedes it.
    <View style={{ width: contentW, alignSelf: "center", paddingBottom: 8 }} onLayout={(e) => (stickyY.current = e.nativeEvent.layout.y + e.nativeEvent.layout.height)}>
      <ScreenHeader
        title={t("wardrobe.title")}
        count={visible.length}
        safeArea={!desktop}
        actions={
          <>
            <Button
              variant="icon"
              icon="tune"
              dot={sheetActive}
              accessibilityLabel={t(sheetActive ? "wardrobe.filter.openActive" : "wardrobe.filter.open")}
              onPress={() => setFilterOpen(true)}
            />
            {onMove ? (
              <Button
                variant="icon"
                icon="backpack"
                selected={packing}
                accessibilityLabel={t("wardrobe.reserve.open")}
                onPress={() => (packing ? stopPacking() : startPacking())}
                disabled={busy}
              />
            ) : null}
          </>
        }
      />
      {packing ? (
        <View className="mt-6">
          <Segmented
            segments={[
              { key: "usual", label: t("wardrobe.reserve.showUsual") },
              { key: "all", label: t("wardrobe.reserve.showAll") },
            ]}
            value={packAll ? "all" : "usual"}
            onChange={(k) => setPackAll(k === "all")}
            accessibilityLabel={t("wardrobe.reserve.mode")}
          />
          <Text className="mt-4 font-body text-body-sm text-ink-soft">{t("wardrobe.reserve.notInWardrobe")}</Text>
        </View>
      ) : away.length > 0 && onMove ? (
        <View className="mt-6">
          <StatusLine
            message={t("wardrobe.reserve.away", { count: away.length, n: ltr(away.length) })}
            action={{ label: t("wardrobe.reserve.backLaundry"), onPress: () => run(away, "laundry") }}
            secondaryAction={{ label: t("wardrobe.reserve.backHome"), onPress: () => run(away, "home") }}
            moreActions={[{ label: t("wardrobe.reserve.packMore"), onPress: startPacking }]}
            disabled={busy}
          />
        </View>
      ) : null}
      {failed && !packing ? (
        <View className="mt-2">
          <StatusLine variant="error" message={t("wardrobe.reserve.failed")} />
        </View>
      ) : null}
    </View>
  );

  const sticky = (
    <View className="bg-ivory pt-4">
      <View style={{ width: rowWidth, alignSelf: "center" }}>
        <TextTabs tabs={tabs} value={activeScope} onChange={setScope} accessibilityLabel={t("wardrobe.categories")} inset={rowInset} />
      </View>
    </View>
  );

  const activeChips = SHEET_FACETS.flatMap((facet) => {
    const value = selection[facet];
    return value === undefined ? [] : [{ facet, value, label: t(`wardrobe.${facet}.${value}`) }];
  });

  // Under "all" the first section heading sits 24 below what the eye reads as the last row above it. The swatch row's
  // box is the 44 hit target around a 24 swatch, so 10 of that 24 is already inside the row; chips are 36 visible
  // with their hit area outside the layout box, so they need the full 24. One category (no headings): 16 to the tiles.
  const subheaderGap =
    activeScope !== "all" || visible.length === 0 ? 16 : activeChips.length > 0 || swatches.length === 0 ? HEADING_GAP : HEADING_GAP - (layout.hit - SWATCH_VISIBLE) / 2;

  const subheader = (
    <View style={{ width: rowWidth, alignSelf: "center" }} className="pt-3">
      <SwatchRow swatches={swatches} selected={selection.color} onToggle={(name) => toggle("color", name)} inset={rowInset} />
      {filtersActive ? (
        <View className="mt-2 flex-row items-center">
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            accessibilityLabel={t("wardrobe.activeFilters")}
            // A chip's 44 hit box overhangs its 36 face by 4 on each side and a scroll view clips what overhangs it: the
            // content keeps 4 of vertical room and the negative margin gives it back, so the row does not move.
            style={{ flexGrow: 1, flexShrink: 1, marginVertical: -4 }}
            contentContainerStyle={{ paddingStart: rowInset, paddingEnd: 12, paddingVertical: 4, gap: 8 }}
          >
            {activeChips.map((c) => (
              <Chip key={c.facet} label={c.label} removable onPress={() => toggle(c.facet, c.value)} />
            ))}
          </ScrollView>
          {/* Outside the scrolling part so clear-all is always in view, whatever the chips' count or width. */}
          <View style={{ paddingEnd: rowInset }}>
            <Button variant="text" label={t("wardrobe.filter.clear")} onPress={clearFilters} />
          </View>
        </View>
      ) : null}
      <View style={{ height: subheaderGap }} />
    </View>
  );

  const footer =
    visible.length > 0 ? undefined : (
      <View style={{ width: contentW, alignSelf: "center" }}>
        {items.length === 0 ? (
          <EmptyState title={t("wardrobe.emptyTitle")} body={t("wardrobe.empty")} action={{ label: t("nav.addClothes"), onPress: () => router.push("/intake") }} />
        ) : (
          <EmptyState
            title={t("wardrobe.noMatch")}
            body={t("wardrobe.noMatchBody")}
            action={anyFilter ? { label: t("wardrobe.clearFilters"), onPress: clearAll } : undefined}
          />
        )}
      </View>
    );

  return (
    <View className="flex-1 bg-ivory">
      <MasonryGrid
        sections={sections}
        width={contentW}
        columns={columns}
        captionHeight={TILE_CAPTION_HEIGHT}
        sectionHeaderHeight={SECTION_HEADER_H}
        keyOf={keyOf}
        aspectOf={aspectOf}
        renderItem={renderItem}
        ListHeaderComponent={header}
        StickyHeaderComponent={sticky}
        ListSubheaderComponent={subheader}
        ListFooterComponent={footer}
        scrollRef={scrollRef}
        onScroll={(e) => (scrollY.current = e.nativeEvent.contentOffset.y)}
        // Nothing may end under the floating bar; otherwise the tab bar under the screen owns the bottom inset.
        contentContainerStyle={{ paddingBottom: (packing ? barHeight + UNDER_BAR : 64) + (desktop ? insets.bottom : 0) }}
      />
      {packing ? (
        // safeArea off: the wardrobe renders inside the tabs, whose bar below already takes the bottom inset.
        <ActionBar floating safeArea={desktop} onLayout={(e) => setBarHeight(e.nativeEvent.layout.height)}>
          <View style={{ width: "100%", maxWidth: contentW, alignSelf: "center", gap: 8 }}>
            {failed ? <StatusLine variant="error" message={t("wardrobe.reserve.failed")} /> : null}
            <Text className="font-body text-body-sm text-ink" accessibilityLiveRegion="polite">
              {pickedLine}
            </Text>
            <View className="flex-row items-center" style={{ gap: 8 }}>
              <View style={{ flex: 1 }}>
                <Button
                  variant="primary"
                  label={t("wardrobe.reserve.confirm")}
                  disabled={busy || picked.size === 0}
                  onPress={() => run([...picked], "away", stopPacking)}
                  fullWidth
                />
              </View>
              <Button variant="outline" label={t("wardrobe.reserve.cancel")} disabled={busy} onPress={stopPacking} />
            </View>
          </View>
        </ActionBar>
      ) : null}
      <FilterSheet
        open={filterOpen}
        onClose={() => setFilterOpen(false)}
        facets={facets}
        selection={selection}
        onToggle={toggle}
        onClear={clearSheet}
      />
      <ItemActionsSheet
        item={actionsItem}
        open={actionsOpen}
        onClose={() => setActionsOpen(false)}
        onAvailability={onAvailability ? (item, next) => onAvailability(item.id, next, item.availability) : undefined}
        onArchive={onArchive ? (item) => onArchive(item.id) : undefined}
        onOpenItem={(item) => {
          setActionsOpen(false);
          void openItem(item.id);
        }}
      />
    </View>
  );
}
