import type { Item } from "@fit-check/schema";
import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Text, View, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Button, EmptyState, MasonryGrid, ScreenHeader, Sheet, StatusLine, Tile, TILE_CAPTION_HEIGHT } from "../../components/ui";
import { tileAspect } from "../../theme/tileTone";
import { layout, masonryColumnsFor } from "../../theme/tokens";
import { byName } from "../wardrobe/filters";

type Props = {
  /** The archived items (any order; shown by name). */
  items: readonly Item[];
  /** Back to the previous screen, or to Profile when there is no history (a deep link). */
  onBack: () => void;
  /** Puts the item back in the wardrobe; optimistic in the container (the tile leaves at once), rejects when the write failed. */
  onRestore: (id: string) => Promise<void>;
};

/**
 * "ארכיון" (DESIGN.md "שלב 2: תוספות"): what was removed from the wardrobe, as the same masonry of tiles, so a
 * removal is never final. A tile opens a sheet with the item's name and one way back, "שחזר לארון". The tile leaves
 * at once; a failed write brings it back with an error line at the top of the screen.
 */
export function ArchiveView({ items, onBack, onRestore }: Props) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { width: windowW } = useWindowDimensions();
  const contentW = Math.min(windowW, layout.maxContentWidthWide) - 2 * layout.gridGutter;
  const columns = masonryColumnsFor(windowW);

  // The sheet keeps the item it was opened for, so its title does not vanish under the closing animation.
  const [chosen, setChosen] = useState<Item | null>(null);
  const [open, setOpen] = useState(false);
  const [failed, setFailed] = useState(false);

  const sorted = useMemo(() => [...items].sort(byName), [items]);

  const choose = useCallback((item: Item) => {
    setFailed(false);
    setChosen(item);
    setOpen(true);
  }, []);

  const restore = (item: Item) => {
    setOpen(false);
    setFailed(false);
    onRestore(item.id).catch((error: unknown) => {
      console.error("Restore failed", error);
      setFailed(true);
    });
  };

  const typeOf = useCallback((i: Item) => t(`item.subcategory.${i.tags.subcategory}`), [t]);
  const renderItem = useCallback(
    (item: Item, { width }: { width: number }) => {
      const type = typeOf(item);
      const color = t(`wardrobe.color.${item.tags.color_name}`);
      return (
        <Tile
          item={item}
          width={width}
          caption={{ title: item.name, meta: `${type} · ${color}` }}
          accessibilityLabel={t("wardrobe.tileLabel", { name: item.name, type, color })}
          onPress={() => choose(item)}
        />
      );
    },
    [t, typeOf, choose]
  );
  const keyOf = useCallback((i: Item) => i.id, []);
  const aspectOf = useCallback((i: Item) => tileAspect(i.tags.subcategory), []);

  const header = (
    <View style={{ width: contentW, alignSelf: "center", paddingTop: insets.top + 8, paddingBottom: 16 }}>
      {/* The glyph sits 10px inside its 44 box; pulling the box out by 8 lines the arrow up with the title's edge. */}
      <View style={{ alignSelf: "flex-start", marginStart: -8 }}>
        <Button variant="icon" icon="arrow_back" accessibilityLabel={t("common.back")} onPress={onBack} />
      </View>
      <ScreenHeader title={t("archive.title")} count={sorted.length} safeArea={false} />
      {sorted.length > 0 ? <Text className="mt-2 font-body text-body-sm text-ink-soft">{t("archive.hint")}</Text> : null}
      {failed ? (
        <View className="mt-4">
          <StatusLine variant="error" message={t("archive.restoreFailed")} />
        </View>
      ) : null}
    </View>
  );

  const footer =
    sorted.length > 0 ? undefined : (
      <View style={{ width: contentW, alignSelf: "center" }}>
        <EmptyState title={t("archive.emptyTitle")} body={t("archive.empty")} />
      </View>
    );

  return (
    <View className="flex-1 bg-ivory">
      <MasonryGrid
        items={sorted}
        width={contentW}
        columns={columns}
        captionHeight={TILE_CAPTION_HEIGHT}
        keyOf={keyOf}
        aspectOf={aspectOf}
        renderItem={renderItem}
        ListHeaderComponent={header}
        ListFooterComponent={footer}
        contentContainerStyle={{ paddingBottom: insets.bottom + 64 }}
      />
      <Sheet open={open && chosen !== null} onClose={() => setOpen(false)} title={chosen?.name}>
        {chosen ? (
          <View className="mt-2">
            <Text className="font-body text-body-sm text-ink-soft">{t("archive.restoreHint")}</Text>
            <View className="mt-6">
              <Button variant="ink" label={t("archive.restore")} onPress={() => restore(chosen)} fullWidth />
            </View>
          </View>
        ) : null}
      </Sheet>
    </View>
  );
}
