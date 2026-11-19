import type { Item } from "@fit-check/schema";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ScrollView, View, useWindowDimensions } from "react-native";
import { EmptyState, OutfitTile, OutfitTileSkeleton, ScreenHeader, StatusLine, TabPanel, TextTabs, type FlatLayPiece } from "../../components/ui";
import { reasonOf } from "../../data/intake";
import type { SavedOutfit } from "../../data/savedOutfit";
import { useWardrobe } from "../../data/WardrobeProvider";
import { layout } from "../../theme/tokens";
import { failureMessage } from "../intake/failure";
import { shortDate, ltr } from "../insights/format";
import { spoken } from "../item/a11y";
import { useIsDesktop } from "../shell/ShellTabBar";
import { legendEntries, outfitCaption, outfitGridColumns, outfitTileWidth, visibleOutfits, wornMeta, type OutfitsTab } from "./collection";
import { refreshOutfits, toggleFavorite, useSavedOutfits } from "./store";

/**
 * Between rows of the grid. Wider than the wardrobe's 16 on purpose (lead's review of the first build, 2026-11-19):
 * at 16 the meta line sat as close to the next row's flat-lay as to its own, so a caption read as the title of the
 * outfit below it. 24 keeps each caption with the tile above.
 * don't touch / applied as a bottom margin on each tile, not as `rowGap` on the grid: on the web build `rowGap` next to
 * `columnGap` in one inline style was dropped on most paths (independent check, 2026-11-19: row-gap computed as
 * `normal`, captions 0 px above the next row), so the first fix never reached the screen.
 */
const OUTFIT_ROW_GAP = 24;

/** Ids of the tabs and their panel (WAI-ARIA tabs pattern). */
const TABS_ID = "outfits";
/** Tiles shown while the collection loads: two rows on a phone, one on desktop. */
const SKELETON_TILES = 4;

type Props = { userId: string };

/** The wardrobe's current copy of a garment when it has one (availability, name), else the copy saved with the outfit. */
function useResolve(): (item: Item) => Item {
  const wardrobe = useWardrobe();
  const byId = useMemo(() => new Map(wardrobe.status === "ready" ? wardrobe.items.map((i) => [i.id, i] as const) : []), [wardrobe]);
  return useCallback((item: Item) => byId.get(item.id) ?? item, [byId]);
}

/**
 * The "לוקים" tab (DESIGN.md "שלב 5.2" item 3): the saved outfits, newest saved first, as a grid of outfit tiles (2
 * columns up to 599, 3 up to 899, 4 above, gap 8, in the wardrobe's content width), with "all" and "favourites" text
 * tabs. A tile opens the outfit; its heart toggles the favourite optimistically and rolls back with an error line.
 *
 * Reads on every focus (an outfit saved, renamed or removed elsewhere shows when the user comes back); the last list
 * stays on screen meanwhile. Loading: tiles at their final size, pulsing (no spinner). A failed read with nothing to
 * show: an error line with retry. Empty: "no outfits yet" (no action until the build screen exists, stage 5.2 #4).
 */
export function OutfitsView({ userId }: Props) {
  const { t, i18n } = useTranslation();
  const locale = i18n.language === "en" ? "en" : "he";
  const router = useRouter();
  const desktop = useIsDesktop();
  const { width: windowW } = useWindowDimensions();
  const state = useSavedOutfits(userId);
  const resolve = useResolve();
  const [tab, setTab] = useState<OutfitsTab>("all");
  const [favoriteError, setFavoriteError] = useState<{ id: string; favorite: boolean; message: string } | null>(null);

  useFocusEffect(
    useCallback(() => {
      void refreshOutfits(userId);
    }, [userId])
  );

  const contentW = Math.min(windowW, layout.maxContentWidthWide) - 2 * layout.gridGutter;
  const columns = outfitGridColumns(windowW);
  const tileW = outfitTileWidth(contentW, columns, layout.gridGap);
  const shown = visibleOutfits(state.outfits, tab);
  const typeOf = useCallback((sub: string) => t(`item.subcategory.${sub}`), [t]);

  const toggle = (outfit: SavedOutfit, favorite: boolean) => {
    setFavoriteError(null);
    void toggleFavorite(userId, outfit.id, favorite).then((r) => {
      if (typeof r === "object") {
        setFavoriteError({ id: outfit.id, favorite, message: t("outfits.favoriteFailed", { reason: failureMessage(t, reasonOf(r.error)) }) });
      }
    });
  };

  const metaOf = (o: SavedOutfit) => {
    const w = wornMeta(o);
    const wear = w.kind === "never" ? t("outfits.neverWorn") : t("outfits.wornWithDate", { worn: t("outfits.worn", { count: w.count, n: ltr(w.count) }), date: shortDate(w.last, locale) });
    return o.missing.length > 0 ? t("outfits.missingMeta", { rest: wear }) : wear;
  };

  const tile = (o: SavedOutfit) => {
    const entries = legendEntries(o, resolve);
    const pieces: FlatLayPiece[] = entries.flatMap((e) => (e.item ? [{ slot: e.slot, item: e.item, index: e.index, accessibilityLabel: e.item.name }] : []));
    const caption = outfitCaption({ name: o.name, pieces }, typeOf);
    const meta = metaOf(o);
    return (
      <View key={o.id} style={{ width: tileW, marginBottom: OUTFIT_ROW_GAP }}>
        <OutfitTile
          pieces={pieces}
          title={caption.text}
          meta={meta}
          favorite={o.isFavorite}
          onPress={() => router.push({ pathname: "/outfit/[id]", params: { id: o.id } })}
          onToggleFavorite={() => toggle(o, !o.isFavorite)}
          accessibilityLabel={spoken(t("outfits.tileLabel", { title: caption.text, pieces: pieces.map((p) => p.item.name).join(", "), meta }))}
          favoriteLabel={t(o.isFavorite ? "outfits.favoriteRemove" : "outfits.favoriteAdd")}
        />
      </View>
    );
  };

  let body;
  if (state.status === "loading" && state.outfits.length === 0) {
    body = (
      <View className="flex-row flex-wrap" style={{ columnGap: layout.gridGap }}>
        {Array.from({ length: SKELETON_TILES }, (_, n) => (
          <View key={n} style={{ width: tileW, marginBottom: OUTFIT_ROW_GAP }}>
            <OutfitTileSkeleton />
          </View>
        ))}
      </View>
    );
  } else if (state.status === "error") {
    body = <StatusLine variant="error" message={t("outfits.loadFailed")} action={{ label: t("common.retry"), onPress: () => void refreshOutfits(userId) }} />;
  } else if (shown.length === 0) {
    body =
      tab === "all" ? (
        <EmptyState title={t("outfits.empty.title")} body={t("outfits.empty.body")} />
      ) : (
        <EmptyState title={t("outfits.emptyFavorites.title")} body={t("outfits.emptyFavorites.body")} />
      );
  } else {
    body = (
      // 8 between columns; OUTFIT_ROW_GAP under every tile (see the constant for why it is a margin and not rowGap).
      <View className="flex-row flex-wrap" style={{ columnGap: layout.gridGap }}>
        {shown.map(tile)}
      </View>
    );
  }

  const ready = state.status === "ready" || state.outfits.length > 0;
  return (
    <View className="flex-1 bg-ivory">
      <ScrollView contentContainerStyle={{ paddingBottom: 64 }}>
        <View style={{ width: contentW, alignSelf: "center" }}>
          <ScreenHeader title={t("outfits.title")} count={ready ? shown.length : undefined} safeArea={!desktop} />
          <View className="mt-4">
            {/* inset 0: the grid and the first word share the content edge. */}
            <TextTabs<OutfitsTab>
              tabs={[
                { key: "all", label: t("outfits.tabs.all") },
                { key: "favorites", label: t("outfits.tabs.favorites") },
              ]}
              value={tab}
              onChange={setTab}
              accessibilityLabel={t("outfits.tabsLabel")}
              idPrefix={TABS_ID}
            />
          </View>
          {favoriteError ? (
            <View className="mt-4">
              <StatusLine
                variant="error"
                message={favoriteError.message}
                action={{
                  label: t("common.retry"),
                  onPress: () => {
                    const o = state.outfits.find((x) => x.id === favoriteError.id);
                    if (o) toggle(o, favoriteError.favorite);
                    else setFavoriteError(null);
                  },
                }}
              />
            </View>
          ) : null}
          <View className="mt-6">
            <TabPanel idPrefix={TABS_ID} selectedKey={tab}>
              {body}
            </TabPanel>
          </View>
        </View>
      </ScrollView>
    </View>
  );
}
