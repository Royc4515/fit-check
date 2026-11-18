import type { PairWeights } from "@fit-check/engine";
import type { Availability, Item } from "@fit-check/schema";
import { Image, type ImageLoadEventData } from "expo-image";
import { useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { BackHandler, Platform, View, useWindowDimensions } from "react-native";
import Animated, { useAnimatedRef } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { cutoutUrl, ItemArt } from "../../components/item-art/ItemArt";
import { Button, Display, StatusLine } from "../../components/ui";
import { useRtl } from "../../components/ui/interaction";
import { tileTone } from "../../theme/tileTone";
import { colors, layout } from "../../theme/tokens";
import type { ItemEdits } from "./edit";
import { heroGeometry } from "./geometry";
import { ItemActions, type ImageStatus } from "./ItemActions";
import { ItemDetails } from "./ItemDetails";
import { flyFrom } from "./transition";
import { useItemFlight } from "./useItemFlight";
import { spoken } from "./a11y";

/** ItemArt draws into a square viewBox, centred. */
const DRAWING_ASPECT = 1;
/** Hero buttons sit this far in from the hero's corner (below the safe area on a phone). Spacing-scale value. */
const CORNER = 12;
/** Space above the details on a phone, under the hero. */
const DETAILS_TOP = 32;
/** Room under the last section so it can scroll clear of the home indicator. */
const BOTTOM_AIR = 64;

type Props = {
  id: string | undefined;
  items: Item[];
  pairWeights: PairWeights;
  onAvailability?: (itemId: string, next: Availability, prev: Availability) => Promise<void>;
  edits?: ItemEdits;
};

const fill = { position: "absolute", top: 0, bottom: 0, start: 0, end: 0 } as const;

/**
 * The item screen (DESIGN.md section 3 "פריט"): the picture on its own tile tone, 56% of a phone screen and edge to
 * edge, arriving by the shared element; back and more as two ivory squares over it; the details below (or, from
 * 900px, in the end column beside a held picture). The route is a transparent modal above the tabs, so whatever
 * opened it stays visible underneath until the ivory page has faded in.
 */
export function ItemView({ id, items, pairWeights, onAvailability, edits }: Props) {
  const { t } = useTranslation();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const rtl = useRtl();
  const { width: windowW, height: windowH } = useWindowDimensions();
  const item = useMemo(() => items.find((i) => i.id === id), [items, id]);
  const geo = heroGeometry(windowW, windowH, rtl);
  const heroTone = tileTone(item?.tags.color_hex);
  // A deep link has nothing beneath it: back alone faded the page out and left a blank screen (seen 2026-11-18),
  // so it lands on Today, the app's opening screen.
  const goBack = useCallback(() => (router.canGoBack() ? router.back() : router.replace("/")), [router]);
  const flight = useItemFlight(id, geo, heroTone, goBack);
  const { close, onAspect, onCopyShown } = flight;
  const scroll = useAnimatedRef<Animated.ScrollView>();
  const [actionsOpen, setActionsOpen] = useState(false);
  const [imageStatus, setImageStatus] = useState<ImageStatus | null>(null);

  useEffect(() => {
    // Hardware back is an Android thing; react-native-web's BackHandler is a stub that logs an error.
    if (Platform.OS !== "android") return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      void close();
      return true;
    });
    return () => sub.remove();
  }, [close]);

  useEffect(() => {
    if (item && !item.cutout_path) {
      onAspect(DRAWING_ASPECT);
      // A drawing is painted with the first frame, nothing to wait for.
      onCopyShown();
    }
  }, [item, onAspect, onCopyShown]);

  /** Another item from "goes with": measure the pressed garment first so the next screen flies from it. */
  const openOther = async (scope: string, otherId: string) => {
    await flyFrom(scope, otherId);
    router.push({ pathname: "/item/[id]", params: { id: otherId } });
  };

  const { ground, pad } = geo;
  const originTone = flight.origin?.tone;
  const hero = item ? (
    <View
      pointerEvents="none"
      accessible
      accessibilityRole="image"
      accessibilityLabel={spoken(item.name)}
      style={{ position: "absolute", start: geo.start, top: ground.y, width: ground.width, height: ground.height }}
    >
      <Animated.View style={[fill, { backgroundColor: colors[heroTone] }, flight.groundStyle]}>
        {originTone && originTone !== heroTone ? <Animated.View style={[fill, { backgroundColor: colors[originTone] }, flight.originToneStyle]} /> : null}
      </Animated.View>
      <Animated.View style={[{ position: "absolute", top: pad, bottom: pad, start: pad, end: pad }, flight.imageStyle]}>
        {item.cutout_path ? (
          <Image
            // don't touch / the full cutout, never the thumbnail: the hero is the largest the picture is ever shown.
            source={{ uri: cutoutUrl(item.cutout_path) }}
            contentFit="contain"
            cachePolicy="memory-disk"
            onLoad={(e: ImageLoadEventData) => {
              const { width, height } = e.source;
              if (width > 0 && height > 0) onAspect(height / width);
            }}
            // The copy is on screen: the origin's picture can go now (useItemFlight).
            onDisplay={onCopyShown}
            style={{ width: "100%", height: "100%" }}
            accessibilityIgnoresInvertColors
          />
        ) : (
          <ItemArt tags={item.tags} />
        )}
      </Animated.View>
    </View>
  ) : null;

  const status = imageStatus ? (
    imageStatus.kind === "replacing" ? (
      <StatusLine message={t("item.edit.replacing")} />
    ) : imageStatus.kind === "kept-uncut" ? (
      <StatusLine message={t("item.image.keptUncut")} action={{ label: t("ui.close"), onPress: () => setImageStatus(null) }} />
    ) : (
      <StatusLine variant="error" message={imageStatus.message} action={{ label: t("ui.close"), onPress: () => setImageStatus(null) }} />
    )
  ) : null;

  const details = item ? (
    <ItemDetails
      item={item}
      items={items}
      pairWeights={pairWeights}
      onAvailability={onAvailability}
      edits={edits}
      imageStatus={status}
      onOpenOther={(scope, otherId) => void openOther(scope, otherId)}
      onScrollTop={() => scroll.current?.scrollTo({ y: 0, animated: true })}
      bleed={!geo.desktop}
    />
  ) : (
    <Display level={1}>{t("item.notFound")}</Display>
  );

  // Desktop: the details column starts beside the picture; the page is capped at 1200 and centred.
  const column = geo.column
    ? { width: "100%" as const, maxWidth: layout.maxContentWidthWide, alignSelf: "center" as const, paddingStart: geo.column.offsetStart, paddingEnd: 32, paddingTop: ground.y + 64 }
    : { width: "100%" as const, maxWidth: layout.maxContentWidth, alignSelf: "center" as const, paddingTop: (item ? ground.height : insets.top + 64) + DETAILS_TOP };

  // The buttons sit on the hero's corners: below the safe area on a phone, inside the held picture on desktop. On a
  // phone they scroll away with the picture: held over the text they cut into the name (looked at, 2026-11-18).
  const buttonsTop = geo.desktop ? ground.y + CORNER : insets.top + CORNER;
  const buttons = (
    <Animated.View
      pointerEvents="box-none"
      style={[
        { position: "absolute", top: buttonsTop, start: geo.start + CORNER, width: geo.desktop ? ground.width - 2 * CORNER : windowW - 2 * CORNER },
        flight.fadeStyle,
      ]}
    >
      <View pointerEvents="box-none" className="flex-row justify-between">
        <Button variant="icon" surface icon="arrow_back" accessibilityLabel={t("item.close")} onPress={() => void close()} />
        {item && edits ? <Button variant="icon" surface icon="more_horiz" accessibilityLabel={t("item.more")} onPress={() => setActionsOpen(true)} /> : null}
      </View>
    </Animated.View>
  );

  return (
    <View style={{ flex: 1 }}>
      {/* The ivory page fades in over the screen underneath: "the rest fades" while the picture travels. */}
      <Animated.View pointerEvents="none" style={[fill, { backgroundColor: colors.ivory }, flight.fadeStyle]} />
      <Animated.ScrollView ref={scroll} onScroll={flight.onScroll} scrollEventThrottle={16} contentContainerStyle={{ paddingBottom: insets.bottom + BOTTOM_AIR }}>
        <View style={column}>
          <Animated.View style={[{ paddingHorizontal: geo.desktop ? 0 : layout.gutter }, flight.contentStyle]}>{details}</Animated.View>
        </View>
        {/* After the details in the tree, so the flying picture passes over the text, not under it. */}
        {geo.desktop ? null : hero}
        {geo.desktop ? null : buttons}
      </Animated.ScrollView>
      {/* Desktop: held in its column while the details scroll. */}
      {geo.desktop ? hero : null}
      {geo.desktop ? buttons : null}
      {item && edits ? (
        <ItemActions item={item} edits={edits} open={actionsOpen} onClose={() => setActionsOpen(false)} onRemoved={() => void close()} onImageStatus={setImageStatus} />
      ) : null}
    </View>
  );
}
