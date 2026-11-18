import type { Slot } from "@fit-check/schema";
import { Image, type ImageContentPosition, type ImageLoadEventData } from "expo-image";
import { useCallback, useEffect, useState, type ComponentProps } from "react";
import { Pressable, Text, View, type LayoutChangeEvent } from "react-native";
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import { cutoutUrl, ItemArt } from "../item-art/ItemArt";
import { tileTone } from "../../theme/tileTone";
import { colors, motion } from "../../theme/tokens";
import { focusRingProps, timing, usePressFeedback, useRtl } from "./interaction";
import type { TileItem } from "./Tile";

/**
 * Which side of the garment its number sits on: `below-start` = under the garment, aligned with its start edge;
 * `end-top` = past its end edge, aligned with its top; and so on. Measured from the garment as drawn, not from its
 * box, so the number stays beside the cloth whatever the photo's shape.
 */
export type FlatLayNumberSide = "below-start" | "below-end" | "above-start" | "above-end" | "start-top" | "end-top";

/**
 * Where one garment lies on the flat-lay. Every number is a percentage of the surface: `start` and `width` of its
 * width, `top` and `height` of its height. Logical `start`, so RTL mirrors the whole table with no second config.
 */
export type FlatLayPlacement = {
  start: number;
  top: number;
  width: number;
  height: number;
  /** Where the garment sits inside its box when its shape leaves room (`contain`). */
  alignX: "start" | "center" | "end";
  alignY: "top" | "center" | "bottom";
  /** Where the 01-04 index goes, relative to the drawn garment. Always into empty table, never onto cloth. */
  num: FlatLayNumberSide;
};

/** Arrangements by piece count. Slots are the schema's; a 3-piece outfit has no layer. */
export type FlatLayConfig = {
  three: Record<Exclude<Slot, "layer">, FlatLayPlacement>;
  four: Record<Slot, FlatLayPlacement>;
};

/**
 * The Today composition (DESIGN.md section 3 "היום" item 2), tuned by looking at real outfits at 360-1280px.
 * Boxes are bounding boxes per garment kind and `contain` does the rest: trousers get a tall narrow box, shoes a
 * short one, so each lands at a believable size relative to the others whatever the photo's crop.
 */
export const FLAT_LAY: FlatLayConfig = {
  three: {
    top: { start: 5, top: 5, width: 58, height: 44, alignX: "center", alignY: "top", num: "below-start" },
    bottom: { start: 43, top: 20, width: 44, height: 72, alignX: "center", alignY: "center", num: "end-top" },
    shoes: { start: 12, top: 72, width: 30, height: 22, alignX: "end", alignY: "bottom", num: "above-start" },
  },
  four: {
    layer: { start: 3, top: 3, width: 54, height: 42, alignX: "start", alignY: "top", num: "below-start" },
    top: { start: 13, top: 11, width: 50, height: 40, alignX: "center", alignY: "top", num: "end-top" },
    bottom: { start: 43, top: 20, width: 44, height: 72, alignX: "center", alignY: "center", num: "end-top" },
    shoes: { start: 12, top: 72, width: 30, height: 22, alignX: "end", alignY: "bottom", num: "above-start" },
  },
};

/** Paint order: what lies underneath first (DESIGN.md: layer, bottom, top, shoes). */
const Z_ORDER: readonly Slot[] = ["layer", "bottom", "top", "shoes"];

/** Height / width of the surface (4:5). */
export const FLAT_LAY_ASPECT = 1.25;

const RISE = 8;
/** Space between a garment's edge and its number, px. */
const NUM_GAP = 8;
/** The number's own box at num-sm: two mono digits (2 × 7.2) and one 18px line. */
const NUM_W = 15;
const NUM_H = 18;
/** Numbers never sit closer than this to the surface edge, px. */
const NUM_INSET = 8;
/** Until the surface has been measured: a common phone width, only to place numbers on the first frame. */
const DEFAULT_WIDTH = 390;

export type FlatLayPiece = {
  slot: Slot;
  item: TileItem;
  /** "01".."04", shared with the caption list so picture and legend agree. */
  index: string;
  /** Screen-reader label for the garment's button, in the active language. */
  accessibilityLabel: string;
};

type Props = {
  pieces: readonly FlatLayPiece[];
  /** Press on a garment. Absent = the garments are pictures, not buttons. */
  onPressPiece?: (slot: Slot) => void;
  /**
   * Changes when the whole outfit is replaced by something that animates on its own (a skip). Then pieces swap
   * instantly instead of cross-fading one by one, so the old outfit never ghosts through the new one.
   */
  instantKey?: string | number;
  /** `none` full-bleed on phones; `md` (6) as a framed image in the desktop column. */
  radius?: "none" | "md";
  /** Lists the pieces; the surface is a group, its garments stay individually reachable. */
  accessibilityLabel: string;
  /**
   * Animated style for the garments layer only (Today's swipe moves the clothes, not the table). The surface
   * clips it, so garments slide out over its edge rather than over the page.
   */
  contentStyle?: ComponentProps<typeof Animated.View>["style"];
};

/**
 * Flat-lay surface: one tile-toned 4:5 ground with the garments themselves on it as transparent cutouts, laid out
 * like a stylist's table (FLAT_LAY). No frames, no shadows (DESIGN.md section 1). The ground is `tile-deep` when any
 * piece is light, so a white shirt stays readable; otherwise `tile`. A mono 01-04 sits beside each garment.
 *
 * When one garment changes (a swap) the old one fades out while the new one fades in and rises 8px, 180ms.
 * Reduced motion: opacity only. A garment without a photo shows its drawing (ItemArt).
 */
export function FlatLay({ pieces, onPressPiece, instantKey, radius = "none", accessibilityLabel, contentStyle }: Props) {
  const four = pieces.some((p) => p.slot === "layer");
  const tone = pieces.some((p) => tileTone(p.item.tags.color_hex) === "tile-deep") ? "tile-deep" : "tile";
  const ordered = Z_ORDER.flatMap((slot) => pieces.filter((p) => p.slot === slot));
  const [width, setWidth] = useState(DEFAULT_WIDTH);
  // Height / width of each photo, by item id, as it loads; the numbers need the drawn shape, not the box.
  const [aspects, setAspects] = useState<Readonly<Record<string, number>>>({});
  const onAspect = useCallback((id: string, aspect: number) => {
    setAspects((cur) => (cur[id] === aspect ? cur : { ...cur, [id]: aspect }));
  }, []);
  const onLayout = (e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width);

  return (
    <View
      role="group"
      accessibilityLabel={accessibilityLabel}
      onLayout={onLayout}
      style={{ width: "100%", aspectRatio: 1 / FLAT_LAY_ASPECT, backgroundColor: colors[tone], borderRadius: radius === "md" ? 6 : 0, overflow: "hidden" }}
    >
      <Animated.View style={[{ position: "absolute", top: 0, bottom: 0, start: 0, end: 0 }, contentStyle]}>
        {ordered.map((p) => {
          const place = placementOf(four, p.slot);
          // The arrangement is part of the identity: going from 3 to 4 pieces moves every box, and a garment that
          // changes place enters fresh rather than cross-fading across the table.
          return place ? (
            <Piece key={`${four ? 4 : 3}-${p.slot}`} piece={p} place={place} instantKey={instantKey} onPress={onPressPiece} onAspect={onAspect} />
          ) : null;
        })}
        {ordered.map((p) => {
          const place = placementOf(four, p.slot);
          const aspect = p.item.cutout_path ? aspects[p.item.id] : DRAWING_ASPECT;
          // Hidden until the photo's shape is known, so a number never jumps from the box corner to the cloth.
          if (!place || aspect === undefined) return null;
          const at = numberPosition(place, aspect, width, !p.item.cutout_path);
          return (
            <Text
              key={`n-${p.slot}`}
              // Numbers are a legend, not targets; the garment and its caption row are the buttons.
              pointerEvents="none"
              accessibilityElementsHidden
              importantForAccessibility="no"
              className="font-mono text-num-sm text-ink-soft"
              style={{ position: "absolute", start: `${at.start}%`, top: `${at.top}%` }}
            >
              {p.index}
            </Text>
          );
        })}
      </Animated.View>
    </View>
  );
}

/** ItemArt draws into a square viewBox, centred (`xMidYMid meet`). */
const DRAWING_ASPECT = 1;

function placementOf(four: boolean, slot: Slot): FlatLayPlacement | undefined {
  if (four) return FLAT_LAY.four[slot];
  return slot === "layer" ? undefined : FLAT_LAY.three[slot];
}

/**
 * Where a garment's number goes, as percentages of the surface. Works in surface-width units (the surface is
 * 1 wide, 1.25 high): the box from the config, the drawn garment inside it from the photo's aspect and the
 * alignment (exactly what `contain` + contentPosition draw), then the number beside the requested edge, clamped
 * inside the surface. Pure arithmetic, so the result is identical at every width except for the fixed px gap.
 */
export function numberPosition(place: FlatLayPlacement, aspect: number, surfaceWidth: number, centred: boolean): { start: number; top: number } {
  const W = Math.max(surfaceWidth, 1);
  const bx = place.start / 100;
  const by = (place.top / 100) * FLAT_LAY_ASPECT;
  const bw = place.width / 100;
  const bh = (place.height / 100) * FLAT_LAY_ASPECT;
  const tall = aspect * bw > bh;
  const gw = tall ? bh / aspect : bw;
  const gh = tall ? bh : bw * aspect;
  const alignX = centred ? "center" : place.alignX;
  const alignY = centred ? "center" : place.alignY;
  const gx = bx + (alignX === "start" ? 0 : alignX === "center" ? (bw - gw) / 2 : bw - gw);
  const gy = by + (alignY === "top" ? 0 : alignY === "center" ? (bh - gh) / 2 : bh - gh);
  const gap = NUM_GAP / W;
  const nw = NUM_W / W;
  const nh = NUM_H / W;
  const [x, y] = ((): [number, number] => {
    switch (place.num) {
      case "below-start":
        return [gx, gy + gh + gap];
      case "below-end":
        return [gx + gw - nw, gy + gh + gap];
      case "above-start":
        return [gx, gy - gap - nh];
      case "above-end":
        return [gx + gw - nw, gy - gap - nh];
      case "start-top":
        return [gx - gap - nw, gy];
      case "end-top":
        return [gx + gw + gap, gy];
    }
  })();
  const inset = NUM_INSET / W;
  const cx = Math.min(Math.max(x, inset), 1 - inset - nw);
  const cy = Math.min(Math.max(y, inset), FLAT_LAY_ASPECT - inset - nh);
  return { start: cx * 100, top: (cy / FLAT_LAY_ASPECT) * 100 };
}

/** expo-image positions in physical edges; the config speaks start/end, so the side flips with the direction. */
function contentPosition(place: FlatLayPlacement, rtl: boolean): ImageContentPosition {
  const v = place.alignY === "top" ? 0 : place.alignY === "bottom" ? "100%" : "50%";
  const x = place.alignX === "center" ? "50%" : (place.alignX === "start") !== rtl ? 0 : "100%";
  return { top: v, left: x };
}

function GarmentImage({ item, place, onAspect }: { item: TileItem; place: FlatLayPlacement; onAspect?: (id: string, aspect: number) => void }) {
  const rtl = useRtl();
  if (!item.cutout_path) return <ItemArt tags={item.tags} />;
  return (
    <Image
      // don't touch / the full cutout, not a thumbnail: the hero is up to 560 wide at 2-3x density.
      source={{ uri: cutoutUrl(item.cutout_path) }}
      contentFit="contain"
      contentPosition={contentPosition(place, rtl)}
      cachePolicy="memory-disk"
      recyclingKey={item.id}
      onLoad={(e: ImageLoadEventData) => {
        const { width, height } = e.source;
        if (width > 0 && height > 0) onAspect?.(item.id, height / width);
      }}
      style={{ width: "100%", height: "100%" }}
      accessibilityIgnoresInvertColors
    />
  );
}

type Layers = { cur: TileItem; prev: TileItem | null; instantKey: string | number | undefined };

function Piece({
  piece,
  place,
  instantKey,
  onPress,
  onAspect,
}: {
  piece: FlatLayPiece;
  place: FlatLayPlacement;
  instantKey: string | number | undefined;
  onPress?: (slot: Slot) => void;
  onAspect: (id: string, aspect: number) => void;
}) {
  const reduce = useReducedMotion();
  const { onPressIn, onPressOut, pressStyle } = usePressFeedback();
  const [layers, setLayers] = useState<Layers>({ cur: piece.item, prev: null, instantKey });
  // Derived during render (not in an effect) so the outgoing garment is still mounted in the very commit the new
  // one arrives; an effect would paint one frame with the new garment at full opacity first.
  if (layers.cur.id !== piece.item.id || layers.instantKey !== instantKey) {
    const instant = layers.instantKey !== instantKey;
    setLayers({ cur: piece.item, prev: instant || layers.cur.id === piece.item.id ? null : layers.cur, instantKey });
  }
  // 1 = settled. A fresh mount enters too: a piece that appears (a layer added) should not pop in.
  const p = useSharedValue(0);
  const prevId = layers.prev?.id ?? null;
  const curId = layers.cur.id;
  useEffect(() => {
    const clear = () => setLayers((l) => (l.prev ? { ...l, prev: null } : l));
    p.set(0);
    p.set(
      withTiming(1, timing(motion.stateMs), (finished) => {
        "worklet";
        if (finished) scheduleOnRN(clear);
      })
    );
  }, [p, curId, prevId]);

  const enter = useAnimatedStyle(() => ({
    opacity: p.get(),
    transform: [{ translateY: reduce ? 0 : (1 - p.get()) * RISE }],
  }));
  const leave = useAnimatedStyle(() => ({ opacity: 1 - p.get() }));

  const box = {
    position: "absolute" as const,
    start: `${place.start}%` as const,
    top: `${place.top}%` as const,
    width: `${place.width}%` as const,
    height: `${place.height}%` as const,
  };
  const fill = { position: "absolute" as const, top: 0, bottom: 0, start: 0, end: 0 };
  const content = (
    // don't touch / pointerEvents none: the box (Pressable) is the target, never the <img> inside it. On web a press
    // that moved on an <img> started the browser's native image drag, which cancels the pointer stream, so a swipe
    // that began on a garment never reached the pan gesture.
    <Animated.View style={[{ flex: 1 }, pressStyle]} pointerEvents="none">
      {layers.prev ? (
        <Animated.View style={[fill, leave]}>
          <GarmentImage item={layers.prev} place={place} />
        </Animated.View>
      ) : null}
      <Animated.View style={[fill, enter]}>
        <GarmentImage item={layers.cur} place={place} onAspect={onAspect} />
      </Animated.View>
    </Animated.View>
  );

  if (!onPress) {
    return (
      <View style={box} accessible accessibilityRole="image" accessibilityLabel={piece.accessibilityLabel}>
        {content}
      </View>
    );
  }
  return (
    <Pressable
      {...focusRingProps}
      style={box}
      onPress={() => onPress(piece.slot)}
      onPressIn={onPressIn}
      onPressOut={onPressOut}
      accessibilityRole="button"
      accessibilityLabel={piece.accessibilityLabel}
    >
      {content}
    </Pressable>
  );
}
