import type { Slot } from "@fit-check/schema";
import { Image, type ImageContentPosition, type ImageLoadEventData } from "expo-image";
import { useCallback, useEffect, useState, type ComponentProps, type ComponentRef } from "react";
import { Pressable, Text, View, type LayoutChangeEvent } from "react-native";
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import { cutoutUrl, ItemArt } from "../item-art/ItemArt";
import { tileTone } from "../../theme/tileTone";
import { colors, motion } from "../../theme/tokens";
import { focusRingProps, timing, usePressFeedback, useRtl } from "./interaction";
import { useOriginVisibility } from "./originVisibility";
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
   * False takes the garments out of the web keyboard tab order (still pressable by pointer and touch, still named
   * for screen readers). Use it when another control beside the picture does the same thing in reading order: the
   * garments are painted in z-order, so Tab would otherwise walk them out of 01-04 order. Default true.
   */
  pieceFocusable?: boolean;
  /**
   * Changes when the whole outfit is replaced by something that animates on its own (a skip). Then pieces swap
   * instantly instead of cross-fading one by one, so the old outfit never ghosts through the new one.
   */
  instantKey?: string | number;
  /**
   * Changes when the outfit is replaced by another one in place (Today's day tabs): every garment cross-fades in
   * motion.state with no movement (no 8px rise), and under reduced motion the change is immediate. Wins over
   * `instantKey` when both change in the same render.
   */
  fadeKey?: string | number;
  /** `none` full-bleed on phones; `md` (6) as a framed image in the desktop column. */
  radius?: "none" | "md";
  /** Lists the pieces; the surface is a group, its garments stay individually reachable. */
  accessibilityLabel: string;
  /**
   * Animated style for the garments layer only (Today's swipe moves the clothes, not the table). The surface
   * clips it, so garments slide out over its edge rather than over the page.
   */
  contentStyle?: ComponentProps<typeof Animated.View>["style"];
  /** Draw the 01-04 numbers beside the garments. Off for small surfaces, where they would only crowd the cloth. */
  numbered?: boolean;
  /**
   * Receives, per garment, an invisible node laid exactly over the drawn garment (not its box), and null when it
   * unmounts: the item screen's shared element measures it to start and end its flight on the cloth itself.
   */
  onPieceNode?: (itemId: string, node: ComponentRef<typeof View> | null) => void;
  /**
   * The tallest the surface may be, px (Today on a phone: the space left above the bar). The surface stays full
   * width and only gets shorter; the garments and numbers are laid out in a centred 4:5 frame of that height, so
   * the composition is the same, slightly smaller. Absent = a plain 4:5 surface, as every other caller has.
   */
  maxHeight?: number;
};

/** The surface's ground: `tile-deep` when any piece is light, so a white shirt stays readable; otherwise `tile`. */
export function flatLayTone(pieces: readonly Pick<FlatLayPiece, "item">[]): "tile" | "tile-deep" {
  return pieces.some((p) => tileTone(p.item.tags.color_hex) === "tile-deep") ? "tile-deep" : "tile";
}

/**
 * Flat-lay surface: one tile-toned 4:5 ground with the garments themselves on it as transparent cutouts, laid out
 * like a stylist's table (FLAT_LAY). No frames, no shadows (DESIGN.md section 1). The ground is `tile-deep` when any
 * piece is light, so a white shirt stays readable; otherwise `tile`. A mono 01-04 sits beside each garment.
 *
 * When one garment changes (a swap) the old one fades out while the new one fades in and rises 8px, 180ms.
 * Reduced motion: opacity only. A garment without a photo shows its drawing (ItemArt).
 */
export function FlatLay({ pieces, onPressPiece, pieceFocusable = true, instantKey, fadeKey, radius = "none", accessibilityLabel, contentStyle, numbered = true, onPieceNode, maxHeight }: Props) {
  const four = pieces.some((p) => p.slot === "layer");
  const tone = flatLayTone(pieces);
  const ordered = Z_ORDER.flatMap((slot) => pieces.filter((p) => p.slot === slot));
  const [width, setWidth] = useState(DEFAULT_WIDTH);
  // Height / width of each photo, by item id, as it loads; the numbers need the drawn shape, not the box.
  const [aspects, setAspects] = useState<Readonly<Record<string, number>>>({});
  const onAspect = useCallback((id: string, aspect: number) => {
    setAspects((cur) => (cur[id] === aspect ? cur : { ...cur, [id]: aspect }));
  }, []);
  const [measured, setMeasured] = useState(false);
  const onLayout = (e: LayoutChangeEvent) => {
    setWidth(e.nativeEvent.layout.width);
    setMeasured(true);
  };
  // Capped: the height comes from the measured width here, not from aspectRatio + maxHeight, whose interplay differs
  // between Yoga and CSS. Until measured (DEFAULT_WIDTH is a guess) the plain 4:5 surface stands in, as without a cap.
  const height = maxHeight !== undefined && measured ? Math.min(width * FLAT_LAY_ASPECT, maxHeight) : null;
  // The 4:5 frame the composition is laid out in: the whole surface, or a centred column when the cap binds.
  const frameWidth = height !== null ? Math.min(width, height / FLAT_LAY_ASPECT) : width;

  return (
    <View
      role="group"
      accessibilityLabel={accessibilityLabel}
      onLayout={onLayout}
      style={{
        width: "100%",
        ...(height !== null ? { height } : { aspectRatio: 1 / FLAT_LAY_ASPECT }),
        backgroundColor: colors[tone],
        borderRadius: radius === "md" ? 6 : 0,
        // don't touch / the surface clips and carries the tone, not the frame: a swiped outfit slides out over the
        // surface's full width, and a capped surface shows no edge or sliver where the centred frame ends.
        overflow: "hidden",
      }}
    >
      {/* The garments layer is the 4:5 frame: every placement, number, drawn rect and origin node is a percentage of
          it, so they stay true when the surface is capped, and the item flight (which measures the origin nodes in
          window coordinates) still starts on the cloth. */}
      <Animated.View
        style={[
          height !== null ? { height: "100%", width: frameWidth, alignSelf: "center" } : { position: "absolute", top: 0, bottom: 0, start: 0, end: 0 },
          contentStyle,
        ]}
      >
        {ordered.map((p) => {
          const place = placementOf(four, p.slot);
          // The arrangement is part of the identity: going from 3 to 4 pieces moves every box, and a garment that
          // changes place enters fresh rather than cross-fading across the table.
          return place ? (
            <Piece
              key={`${four ? 4 : 3}-${p.slot}`}
              piece={p}
              place={place}
              instantKey={instantKey}
              fadeKey={fadeKey}
              onPress={onPressPiece}
              focusable={pieceFocusable}
              onAspect={onAspect}
              // Until the photo's shape is known its box stands in; a flight then starts slightly off the cloth.
              drawn={onPieceNode ? drawnOf(place, p.item.cutout_path ? aspects[p.item.id] : DRAWING_ASPECT, !p.item.cutout_path) : null}
              onNode={onPieceNode ? (node) => onPieceNode(p.item.id, node) : undefined}
            />
          ) : null;
        })}
        {ordered.map((p) => {
          if (!numbered) return null;
          const place = placementOf(four, p.slot);
          const aspect = p.item.cutout_path ? aspects[p.item.id] : DRAWING_ASPECT;
          // Hidden until the photo's shape is known, so a number never jumps from the box corner to the cloth.
          if (!place || aspect === undefined) return null;
          const at = numberPosition(place, aspect, frameWidth, !p.item.cutout_path);
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

/**
 * The drawn garment as percentages of its own box (where `Piece` lays the origin node), or the whole box while the
 * photo's shape is unknown.
 */
function drawnOf(place: FlatLayPlacement, aspect: number | undefined, centred: boolean): Percents {
  if (aspect === undefined) return { start: 0, top: 0, width: 100, height: 100 };
  const r = drawnRect(place, aspect, centred);
  return {
    start: ((r.start - place.start) / place.width) * 100,
    top: ((r.top - place.top) / place.height) * 100,
    width: (r.width / place.width) * 100,
    height: (r.height / place.height) * 100,
  };
}

type Percents = { start: number; top: number; width: number; height: number };

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
  const { gx, gy, gw, gh } = drawn(place, aspect, centred);
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

/**
 * The drawn garment inside its box, as percentages of the surface: what `contain` + contentPosition actually fill.
 * @param aspect - the photo's height / width; 1 for a drawing (always centred).
 */
export function drawnRect(place: FlatLayPlacement, aspect: number, centred: boolean): { start: number; top: number; width: number; height: number } {
  const { gx, gy, gw, gh } = drawn(place, aspect, centred);
  return { start: gx * 100, top: (gy / FLAT_LAY_ASPECT) * 100, width: gw * 100, height: (gh / FLAT_LAY_ASPECT) * 100 };
}

/** The drawn garment in surface-width units (the surface is 1 wide, 1.25 high). */
function drawn(place: FlatLayPlacement, aspect: number, centred: boolean): { gx: number; gy: number; gw: number; gh: number } {
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
  return { gx, gy, gw, gh };
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

type Key = string | number | undefined;
/** `still`: the last change came with a new fadeKey, so it cross-fades without the rise. */
type Layers = { cur: TileItem; prev: TileItem | null; instantKey: Key; fadeKey: Key; still: boolean };

function Piece({
  piece,
  place,
  instantKey,
  fadeKey,
  onPress,
  focusable,
  onAspect,
  drawn,
  onNode,
}: {
  piece: FlatLayPiece;
  place: FlatLayPlacement;
  instantKey: Key;
  fadeKey: Key;
  onPress?: (slot: Slot) => void;
  focusable: boolean;
  onAspect: (id: string, aspect: number) => void;
  /** Where the garment is drawn inside the box; with `onNode`, an invisible node is laid there for the flight. */
  drawn?: Percents | null;
  onNode?: (node: ComponentRef<typeof View> | null) => void;
}) {
  const reduce = useReducedMotion();
  const { onPressIn, onPressOut, pressStyle } = usePressFeedback();
  // The item screen hides this garment while its shared-element copy flies to or from here.
  const { attach: attachOrigin, style: originStyle } = useOriginVisibility(onNode);
  const [layers, setLayers] = useState<Layers>({ cur: piece.item, prev: null, instantKey, fadeKey, still: false });
  // Derived during render (not in an effect) so the outgoing garment is still mounted in the very commit the new
  // one arrives; an effect would paint one frame with the new garment at full opacity first.
  if (layers.cur.id !== piece.item.id || layers.instantKey !== instantKey || layers.fadeKey !== fadeKey) {
    const still = layers.fadeKey !== fadeKey;
    const instant = !still && layers.instantKey !== instantKey;
    setLayers({ cur: piece.item, prev: instant || layers.cur.id === piece.item.id ? null : layers.cur, instantKey, fadeKey, still });
  }
  // 1 = settled. A fresh mount enters too: a piece that appears (a layer added) should not pop in.
  const p = useSharedValue(0);
  // How far the incoming garment rises: RISE for a swap, 0 for a tab change or reduced motion. A shared value set with
  // the animation, not a render value read in the style: the browser check showed a closure-captured flag still rising.
  const rise = useSharedValue(reduce ? 0 : RISE);
  const prevId = layers.prev?.id ?? null;
  const curId = layers.cur.id;
  const still = layers.still;
  useEffect(() => {
    const clear = () => setLayers((l) => (l.prev ? { ...l, prev: null } : l));
    // Reduced motion: a tab change replaces the outfit at once (DESIGN.md "שלב 4.1" item 3).
    if (reduce && still) {
      p.set(1);
      clear();
      return;
    }
    rise.set(reduce || still ? 0 : RISE);
    p.set(0);
    p.set(
      withTiming(1, timing(motion.stateMs), (finished) => {
        "worklet";
        if (finished) scheduleOnRN(clear);
      })
    );
  }, [p, rise, curId, prevId, reduce, still]);

  const enter = useAnimatedStyle(() => ({
    opacity: p.get(),
    transform: [{ translateY: (1 - p.get()) * rise.get() }],
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
    <Animated.View style={[{ flex: 1 }, pressStyle, originStyle]} pointerEvents="none">
      {layers.prev ? (
        <Animated.View style={[fill, leave]}>
          <GarmentImage item={layers.prev} place={place} />
        </Animated.View>
      ) : null}
      <Animated.View style={[fill, enter]}>
        <GarmentImage item={layers.cur} place={place} onAspect={onAspect} />
      </Animated.View>
      {onNode && drawn ? (
        <View
          ref={attachOrigin}
          collapsable={false}
          style={{ position: "absolute", start: `${drawn.start}%`, top: `${drawn.top}%`, width: `${drawn.width}%`, height: `${drawn.height}%` }}
        />
      ) : null}
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
      // Both: native reads `focusable`; react-native-web renders a <button>, which Tab reaches whatever `focusable` says,
      // so the web needs the explicit tabIndex.
      focusable={focusable}
      tabIndex={focusable ? undefined : -1}
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
