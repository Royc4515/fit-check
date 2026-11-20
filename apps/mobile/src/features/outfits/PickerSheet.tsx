import type { Item, Slot } from "@fit-check/schema";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Text, View, useWindowDimensions } from "react-native";
import { Button, SearchField, Sheet, StatusLine, Tile } from "../../components/ui";
import type { WardrobeState } from "../../data/WardrobeProvider";
import { layout } from "../../theme/tokens";
import { PICKER_PAGE, pickerItems, type Draft } from "./builder";

type Props = {
  /** The slot being chosen for; null = closed. */
  slot: Slot | null;
  /** The garment the slot holds now (gets "הסר" and the selected ring), or null. */
  current: Item | null;
  draft: Draft;
  wardrobe: WardrobeState;
  /** A garment tapped (null = "הסר"). The caller closes the sheet. */
  onChoose: (item: Item | null) => void;
  onClose: () => void;
};

/** Below this content width the grid has three columns, from it four (the desktop dialog, a wide phone). */
const FOUR_COLUMNS_FROM = 420;
/** Between a tile's caption and the next row (DESIGN.md: 16 between a caption and the tile below). */
const ROW_GAP = 16;
/** Loading: one row of placeholder tiles at their final size. */
const LOADING_TILES = 6;

/**
 * The build screen's picker (DESIGN.md "שלב 5.2" item 5): a tall sheet with the search pinned at the top and a grid
 * of mini tiles of every garment of the slot (archived ones excluded), in the order of `pickerItems` (the wardrobe's,
 * then the engine's compatibility with what is already chosen). A tap chooses and closes. A garment that is not at
 * home is dimmed with where it is in its caption, and can be chosen. "הסר" at the top when the slot holds one.
 *
 * Rendering is capped: PICKER_PAGE tiles, then a "הצג עוד (N)" button adds the next page. The search narrows first,
 * so the cap is reached only by scrolling a long slot. Escape, the scrim, the handle or `close` close it, and focus
 * goes back to the row that opened it (the sheet's own focus return).
 */
export function PickerSheet({ slot, current, draft, wardrobe, onChoose, onClose }: Props) {
  const { t } = useTranslation();
  const { width } = useWindowDimensions();
  // The slot stays drawn while the sheet slides away after a choice.
  const [shownSlot, setShownSlot] = useState<Slot | null>(slot);
  const [query, setQuery] = useState("");
  const [limit, setLimit] = useState(PICKER_PAGE);
  if (slot !== null && slot !== shownSlot) setShownSlot(slot);
  // A new opening starts clean: no leftover search, the first page. Derived in render, not in an effect.
  const [openedFor, setOpenedFor] = useState<Slot | null>(slot);
  if (slot !== openedFor) {
    setOpenedFor(slot);
    if (slot !== null) {
      setQuery("");
      setLimit(PICKER_PAGE);
    }
  }

  const ready = wardrobe.status === "ready" ? wardrobe : null;
  const items = useMemo(
    () => (ready && shownSlot ? pickerItems(ready.items, shownSlot, query, draft, ready.pairWeights) : []),
    [ready, shownSlot, query, draft]
  );

  const desktop = width >= layout.desktopMin;
  const contentW = (desktop ? Math.min(layout.dialogWidth, width - 2 * layout.gutter) : width) - 2 * layout.gutter;
  const columns = contentW >= FOUR_COLUMNS_FROM ? 4 : 3;
  const tileW = Math.floor((contentW - layout.gridGap * (columns - 1)) / columns);

  const shown = items.slice(0, limit);
  const more = items.length - shown.length;
  const typeOf = (sub: string) => t(`item.subcategory.${sub}`);

  const tile = (item: Item) => {
    const where = item.availability === "home" ? null : t(`wardrobe.availability.${item.availability}`);
    const type = typeOf(item.tags.subcategory);
    const color = t(`wardrobe.color.${item.tags.color_name}`);
    const label = where ? t("builder.picker.tileLabelWhere", { name: item.name, type, where }) : t("builder.picker.tileLabel", { name: item.name, type, color });
    const selected = current?.id === item.id;
    return (
      <View key={item.id} style={{ width: tileW, marginBottom: ROW_GAP }}>
        <Tile
          item={item}
          size="mini"
          width={tileW}
          caption={{ title: item.name, meta: `${type} · ${where ?? color}` }}
          dimmed={where !== null}
          selected={selected}
          onPress={() => onChoose(item)}
          accessibilityLabel={selected ? t("builder.picker.chosen", { label }) : label}
        />
      </View>
    );
  };

  let body;
  if (wardrobe.status === "error") {
    body = <StatusLine variant="error" message={t("builder.loadFailed")} action={{ label: t("common.retry"), onPress: wardrobe.reload }} />;
  } else if (!ready) {
    body = (
      <View className="flex-row flex-wrap" style={{ columnGap: layout.gridGap }}>
        {Array.from({ length: LOADING_TILES }, (_, n) => (
          <View key={n} style={{ width: tileW, marginBottom: ROW_GAP }}>
            <Tile size="mini" width={tileW} loading caption={{ title: "", meta: "" }} />
          </View>
        ))}
      </View>
    );
  } else if (items.length === 0) {
    body = (
      <Text className="font-body text-body text-ink-soft" accessibilityLiveRegion="polite">
        {query.trim() ? t("builder.picker.noResults", { query: query.trim() }) : t("builder.picker.empty")}
      </Text>
    );
  } else {
    body = (
      <View>
        {/* 8 between columns; ROW_GAP as a margin under each tile (`rowGap` beside `columnGap` is dropped on the web). */}
        <View className="flex-row flex-wrap" style={{ columnGap: layout.gridGap }}>
          {shown.map(tile)}
        </View>
        {more > 0 ? (
          <View style={{ alignItems: "flex-start" }}>
            <Button variant="text" label={t("builder.picker.more", { n: more })} onPress={() => setLimit((n) => n + PICKER_PAGE)} />
          </View>
        ) : null}
      </View>
    );
  }

  const subheader = (
    <View style={{ gap: 4 }}>
      {current ? (
        <View style={{ alignItems: "flex-start" }}>
          <Button variant="text" label={t("builder.picker.remove")} accessibilityLabel={t("builder.picker.removeLabel", { name: current.name })} onPress={() => onChoose(null)} />
        </View>
      ) : null}
      <SearchField value={query} onChangeText={(q) => {
        setQuery(q);
        setLimit(PICKER_PAGE);
      }} placeholder={t("builder.picker.search")} />
    </View>
  );

  return (
    <Sheet open={slot !== null} onClose={onClose} title={shownSlot ? t(`outfit.slotTitle.${shownSlot}`) : undefined} accessibilityLabel={t("builder.choose")} tall subheader={subheader}>
      <View style={{ paddingTop: 8 }}>{body}</View>
    </Sheet>
  );
}
