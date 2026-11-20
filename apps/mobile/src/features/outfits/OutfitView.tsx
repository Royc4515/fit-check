import type { Item, Slot } from "@fit-check/schema";
import { useNavigation, usePreventRemove, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { BackHandler, Platform, ScrollView, Text, View, useWindowDimensions } from "react-native";
import Animated from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Button, Display, EmptyState, FlatLay, LegendRow, ListRow, Meta, Sheet, Skeleton, StatusLine, type FlatLayPiece } from "../../components/ui";
import { fitFlatLay } from "../../components/ui/flatLayFit";
import { useRtl } from "../../components/ui/interaction";
import { reasonOf } from "../../data/intake";
import type { SavedOutfit } from "../../data/savedOutfit";
import { useWardrobe } from "../../data/WardrobeProvider";
import { colors, layout } from "../../theme/tokens";
import { failureMessage } from "../intake/failure";
import { ltr, shortDate } from "../insights/format";
import { spoken } from "../item/a11y";
import { heroGeometry } from "../item/geometry";
import { InlineText } from "../item/InlineText";
import { useItemFlight } from "../item/useItemFlight";
import { useTextWriting } from "../item/useTextWriting";
import type { TextField } from "../item/writing";
import { awayGarments, legendEntries, outfitCaption, wornMeta } from "./collection";
import { loadOutfit, removeFromCollection, renameSavedOutfit, toggleFavorite, useSavedOutfits } from "./store";

/** Space between the block above the hero (header row, status lines) and the hero. */
const HERO_GAP = 16;
/** Room under the last legend row so it can scroll clear of the home indicator. */
const BOTTOM_AIR = 64;
/** Desktop: air above and below the flat-lay column, and the gap between the two columns (as on Today). */
const DESKTOP_PAD = 32;
const DESKTOP_GAP = 64;
const DESKTOP_HERO_MAX = 560;

const fill = { position: "absolute", top: 0, bottom: 0, start: 0, end: 0 } as const;

type Props = {
  id: string | undefined;
  userId: string;
  /** `already`: opened by the build screen because these garments were already saved; says so above the hero. */
  notice?: "already";
};

type Load = "loading" | "missing" | "error" | "done";

/**
 * A saved outfit (DESIGN.md "שלב 5.2" item 4), read-only parts: presented over everything like the item screen, the
 * bar hidden, entering with the item screen's own fade (no shared element). Back at the start, favourite and more at
 * the end; a status line above the hero when a garment is not at home (and when one was deleted); the flat-lay of
 * Today with its numbers, as high as fits without scrolling; the name written in place (or "untitled" in ink-faint,
 * a tap starts writing); a meta line (for when · worn N times · last date); the numbered legend. A garment or a row
 * opens the item. "More" holds only removal, behind a confirm step; after it the screen closes onto the collection.
 *
 * No accent anywhere on this screen in this stage: its main action ("wearing it today") comes with stage 5.2 #5.
 * Failure modes: an unknown or unsaved id is an empty state with a way back; a failed read an error line with retry;
 * a failed favourite rolls the heart back with an error line; a failed rename keeps the field open with its text; a
 * failed removal keeps the confirm step with an error line.
 */
export function OutfitView({ id, userId, notice }: Props) {
  const { t, i18n } = useTranslation();
  const locale = i18n.language === "en" ? "en" : "he";
  const router = useRouter();
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const rtl = useRtl();
  const { width, height: windowH } = useWindowDimensions();
  const desktop = width >= layout.desktopMin;
  const wardrobe = useWardrobe();
  const store = useSavedOutfits(userId);

  // The collection's copy, so a favourite or rename made here is the same object the collection shows.
  const cached = id ? store.outfits.find((o) => o.id === id) : undefined;
  // The outfit being removed: it stays drawn while the page fades out (the store drops it when the write succeeds).
  const [closing, setClosing] = useState<SavedOutfit | null>(null);
  const outfit = cached ?? closing;

  const [load, setLoad] = useState<Load>(cached ? "done" : id ? "loading" : "missing");
  const [attempt, setAttempt] = useState(0);
  // loadOutfit answers from the cache when it can, so this reads the network only for a deep link or a reload. Not
  // keyed on the cache: a removal while the screen is open must not start a read.
  useEffect(() => {
    if (!id) return;
    let active = true;
    void loadOutfit(userId, id).then(
      (o) => active && setLoad(o ? "done" : "missing"),
      (error: unknown) => {
        console.error("Saved outfit read failed", id, error);
        if (active) setLoad("error");
      }
    );
    return () => {
      active = false;
    };
  }, [id, userId, attempt]);

  // A deep link has nothing beneath it: back lands on the collection, where this screen is opened from.
  const goBack = useCallback(() => (router.canGoBack() ? router.back() : router.replace("/outfits")), [router]);
  const geo = heroGeometry(width, windowH, rtl);
  // The item screen's entrance without a flight (no origin id): the page fades in, the content follows by 8px.
  const page = useItemFlight(undefined, geo, "tile", goBack);
  const { close: fadeOut } = page;

  // Writing in place: the outfit's name only (DESIGN.md section 4, "כתיבה במקום").
  const outfitId = outfit?.id ?? null;
  const saveName = useCallback((_field: TextField, draft: string) => (outfitId ? renameSavedOutfit(userId, outfitId, draft) : Promise.resolve()), [userId, outfitId]);
  const failureText = useCallback((error: unknown) => t("outfit.renameFailed", { reason: failureMessage(t, reasonOf(error)) }), [t]);
  const writing = useTextWriting(outfitId ? saveName : null, failureText);
  const { requestLeave, holds } = writing;
  // Ways out the screen does not start (browser back, a swipe) are held while typed text could be lost.
  usePreventRemove(holds, ({ data }) => requestLeave(() => navigation.dispatch(data.action)));
  const close = useCallback(() => requestLeave(() => void fadeOut()), [requestLeave, fadeOut]);

  useEffect(() => {
    // Hardware back is an Android thing; react-native-web's BackHandler is a stub that logs an error.
    if (Platform.OS !== "android") return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      close();
      return true;
    });
    return () => sub.remove();
  }, [close]);

  const [favoriteFailed, setFavoriteFailed] = useState<{ favorite: boolean; message: string } | null>(null);
  const setFavorite = (favorite: boolean) => {
    if (!outfit) return;
    setFavoriteFailed(null);
    void toggleFavorite(userId, outfit.id, favorite).then((r) => {
      if (typeof r === "object") setFavoriteFailed({ favorite, message: t("outfits.favoriteFailed", { reason: failureMessage(t, reasonOf(r.error)) }) });
    });
  };

  const [moreOpen, setMoreOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [removeFailed, setRemoveFailed] = useState<string | null>(null);
  const closeMore = () => {
    setMoreOpen(false);
    setConfirming(false);
    setRemoveFailed(null);
  };
  /** Removal closes the screen, so it asks the writing first, like leaving: an open valid name is saved before. */
  const remove = () => {
    if (!outfit) return;
    const target = outfit;
    setRemoving(true);
    setRemoveFailed(null);
    const go = () => {
      // Held from now on, so the page never shows "not found" between the store dropping it and the fade.
      setClosing(target);
      void removeFromCollection(userId, target.id).then(
        () => {
          setMoreOpen(false);
          void fadeOut();
        },
        (error: unknown) => {
          console.error("Saved outfit removal failed", target.id, error);
          setClosing(null);
          setRemoving(false);
          setRemoveFailed(t("outfit.remove.failed", { reason: failureMessage(t, reasonOf(error)) }));
        }
      );
    };
    requestLeave(
      go,
      () => {
        setRemoving(false);
        closeMore();
      },
      true
    );
  };

  // The wardrobe's current copy of each garment (availability, name, a fresh photo), else the one saved with it.
  const byId = useMemo(() => new Map(wardrobe.status === "ready" ? wardrobe.items.map((i) => [i.id, i] as const) : []), [wardrobe]);
  const resolve = useCallback((item: Item) => byId.get(item.id) ?? item, [byId]);
  const typeOf = useCallback((sub: string) => t(`item.subcategory.${sub}`), [t]);
  const entries = useMemo(() => (outfit ? legendEntries(outfit, resolve) : []), [outfit, resolve]);
  const pieces: FlatLayPiece[] = entries.flatMap((e) =>
    e.item ? [{ slot: e.slot, item: e.item, index: e.index, accessibilityLabel: t("outfit.pieceLabel", { type: typeOf(e.item.tags.subcategory), name: e.item.name }) }] : []
  );
  const openItem = (itemId: string) => router.push({ pathname: "/item/[id]", params: { id: itemId } });
  const openSlot = (slot: Slot) => {
    const item = entries.find((e) => e.slot === slot)?.item;
    if (item) openItem(item.id);
  };

  // Mobile: the flat-lay fits whole between the block above it and the window's bottom edge (DESIGN.md section 3
  // "היום" item 2, the same rule and the same function as Today). Measured, not tuned.
  const [viewportHeight, setViewportHeight] = useState(0);
  const [aboveHeight, setAboveHeight] = useState(0);
  const fit = fitFlatLay({ measured: viewportHeight > 0 && aboveHeight > 0, desktop, width, viewportHeight, heroTop: aboveHeight, bottomReserved: insets.bottom });
  const desktopHero = Math.min(DESKTOP_HERO_MAX, viewportHeight > 0 ? (viewportHeight - aboveHeight - DESKTOP_PAD) / 1.25 : DESKTOP_HERO_MAX);

  const pageStyle = { width: "100%" as const, maxWidth: desktop ? layout.maxContentWidthWide : layout.maxContentWidth, alignSelf: "center" as const };
  const gutter = { paddingHorizontal: desktop ? DESKTOP_PAD : layout.gutter };

  const header = (
    <View className="flex-row items-center justify-between" style={{ marginHorizontal: -8 }}>
      {/* The glyphs sit 10px inside their 44 boxes; pulling the row out by 8 lines them up with the text's edges. */}
      <Button variant="icon" icon="arrow_back" accessibilityLabel={t("common.back")} onPress={close} />
      {outfit ? (
        <View className="flex-row items-center">
          <Button
            variant="icon"
            icon={outfit.isFavorite ? "favorite_fill" : "favorite"}
            selected={outfit.isFavorite}
            accessibilityLabel={t(outfit.isFavorite ? "outfits.favoriteRemove" : "outfits.favoriteAdd")}
            onPress={() => setFavorite(!outfit.isFavorite)}
          />
          <Button variant="icon" icon="more_horiz" accessibilityLabel={t("outfit.more")} onPress={() => setMoreOpen(true)} expanded={moreOpen} />
        </View>
      ) : null}
    </View>
  );

  const away = awayGarments(entries);
  const missingSlots = entries.filter((e) => e.item === null).map((e) => t(`outfit.slot.${e.slot}`));
  const statuses = (
    <>
      {notice === "already" && outfit ? <StatusLine message={t("outfit.alreadySaved")} /> : null}
      {away.length > 0 ? (
        <StatusLine
          message={t("outfit.away", {
            list: away.map((i) => t("outfit.awayItem", { name: i.name, where: t(`outfit.where.${i.availability}`) })).join(", "),
          })}
        />
      ) : null}
      {missingSlots.length > 0 ? <StatusLine message={t("outfit.missing", { slots: missingSlots.join(", ") })} /> : null}
      {favoriteFailed ? (
        <StatusLine variant="error" message={favoriteFailed.message} action={{ label: t("common.retry"), onPress: () => setFavorite(favoriteFailed.favorite) }} />
      ) : null}
    </>
  );

  let content;
  if (!outfit) {
    content =
      load === "loading" ? (
        <View>
          <Skeleton aspect={1.25} radius={desktop ? "md" : "none"} />
          <View className="mt-8" style={{ ...gutter, gap: 8 }}>
            <Skeleton height={46} width="60%" radius="sm" />
            <Skeleton height={18} width="40%" radius="sm" />
          </View>
        </View>
      ) : load === "error" ? (
        <View style={gutter}>
          <StatusLine
            variant="error"
            message={t("outfit.loadFailed")}
            action={{
              label: t("common.retry"),
              onPress: () => {
                setLoad("loading");
                setAttempt((n) => n + 1);
              },
            }}
          />
        </View>
      ) : (
        <View style={gutter}>
          <EmptyState title={t("outfit.notFound.title")} body={t("outfit.notFound.body")} level={1} action={{ label: t("outfit.notFound.action"), onPress: close }} />
        </View>
      );
  } else {
    const caption = outfitCaption({ name: outfit.name, pieces: entries.flatMap((e) => (e.item ? [{ item: e.item }] : [])) }, typeOf);
    const w = wornMeta(outfit);
    const rest = w.kind === "never" ? t("outfits.neverWorn") : t("outfits.wornWithDate", { worn: t("outfits.worn", { count: w.count, n: ltr(w.count) }), date: shortDate(w.last, locale) });
    const heroLabel = spoken(t("outfit.heroLabel", { pieces: pieces.map((p) => p.accessibilityLabel).join(", ") }));
    const hero = (
      <View style={fit.cardWidth !== null ? { width: fit.cardWidth, alignSelf: "center" } : desktop ? { width: desktopHero } : undefined}>
        <FlatLay
          pieces={pieces}
          onPressPiece={openSlot}
          // The legend rows below are the same action in 01-04 order; the garments would be duplicate tab stops.
          pieceFocusable={false}
          radius={desktop || fit.card ? "md" : "none"}
          accessibilityLabel={heroLabel}
          maxHeight={fit.maxHeight}
        />
      </View>
    );
    const details = (
      <View>
        <InlineText
          field="outfitName"
          value={outfit.name ?? ""}
          writing={writing}
          label={t("outfit.nameLabel")}
          editLabel={t(outfit.name ? "outfit.editName" : "outfit.addName")}
          size="display-xl"
          headingLevel={1}
          maxLength={40}
        >
          <Display size="display-xl" level={null} tone={caption.named ? "text-ink" : "text-ink-faint"} style={{ textAlign: "start" }}>
            {caption.named ? caption.text : t("outfit.unnamed")}
          </Display>
        </InlineText>
        <View className="mt-1">
          <Meta>{t("outfit.meta", { context: t(`outfit.context.${outfit.contextType}`), rest })}</Meta>
        </View>
        <View className="mt-8 border-t border-hairline">
          {entries.map((e) =>
            e.item ? (
              <LegendRow
                key={e.slot}
                index={e.index}
                title={typeOf(e.item.tags.subcategory)}
                detail={e.item.name}
                onPress={() => e.item && openItem(e.item.id)}
                accessibilityLabel={spoken(t("outfit.pieceLabel", { type: typeOf(e.item.tags.subcategory), name: e.item.name }))}
              />
            ) : (
              <LegendRow key={e.slot} index={e.index} title={t(`outfit.slotTitle.${e.slot}`)} detail={t("outfit.legendDeleted")} />
            )
          )}
        </View>
      </View>
    );
    content = desktop ? (
      <View className="flex-row items-start" style={{ ...gutter, gap: DESKTOP_GAP }}>
        {hero}
        <View className="flex-1">{details}</View>
      </View>
    ) : (
      <View>
        {hero}
        <View className="mt-8" style={gutter}>
          {details}
        </View>
      </View>
    );
  }

  const sheetTitle = outfit ? outfitCaption({ name: outfit.name, pieces: entries.flatMap((e) => (e.item ? [{ item: e.item }] : [])) }, typeOf) : null;

  return (
    <View style={{ flex: 1 }} onLayout={(e) => setViewportHeight(e.nativeEvent.layout.height)}>
      {/* The ivory page fades in over whatever opened it, as the item screen does without a flight. */}
      <Animated.View pointerEvents="none" style={[fill, { backgroundColor: colors.ivory }, page.fadeStyle]} />
      <ScrollView
        contentContainerStyle={{ paddingBottom: insets.bottom + BOTTOM_AIR }}
        // Native writing: the keyboard insets the scroll and a tap on "שמירה" with the keyboard up presses it.
        automaticallyAdjustKeyboardInsets
        keyboardShouldPersistTaps="handled"
      >
        <Animated.View style={[pageStyle, page.contentStyle]}>
          {/* Everything above the hero, measured as one block for the hero's cap (its bottom padding is the gap). */}
          <View onLayout={(e) => setAboveHeight(e.nativeEvent.layout.height)} style={{ ...gutter, paddingTop: insets.top + 8, paddingBottom: HERO_GAP, gap: 8 }}>
            {header}
            {statuses}
          </View>
          {content}
        </Animated.View>
      </ScrollView>
      {outfit ? (
        <Sheet open={moreOpen} onClose={closeMore} title={sheetTitle?.text}>
          {confirming ? (
            <View style={{ gap: 16 }}>
              <Text className="font-body text-body text-ink">{t("outfit.remove.title")}</Text>
              <Text className="font-body text-body-sm text-ink-soft">{t("outfit.remove.body")}</Text>
              {removeFailed ? <StatusLine variant="error" message={removeFailed} /> : null}
              <View className="flex-row flex-wrap items-center" style={{ columnGap: 24, rowGap: 8 }}>
                <Button variant="ink" label={removing ? t("outfit.remove.removing") : t("outfit.remove.confirm")} disabled={removing} onPress={remove} />
                <Button
                  variant="text"
                  label={t("ui.cancel")}
                  disabled={removing}
                  onPress={() => {
                    setConfirming(false);
                    setRemoveFailed(null);
                  }}
                />
              </View>
            </View>
          ) : (
            <View className="border-t border-hairline">
              <ListRow
                label={t("outfit.edit")}
                onPress={() => {
                  closeMore();
                  // The build screen, filled with this outfit (stage 5.2 item 5); its save comes back here.
                  router.push({ pathname: "/outfit/[id]/edit", params: { id: outfit.id } });
                }}
              />
              <ListRow label={t("outfit.remove.row")} onPress={() => setConfirming(true)} />
            </View>
          )}
        </Sheet>
      ) : null}
    </View>
  );
}
