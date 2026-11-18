import type { Item } from "@fit-check/schema";
import { Image } from "expo-image";
import type { ComponentRef } from "react";
import { Platform, Pressable, Text, View } from "react-native";
import Animated from "react-native-reanimated";
import { cutoutUrl, ItemArt } from "../item-art/ItemArt";
import { tileAspect, tileTone } from "../../theme/tileTone";
import { colors, motion, shadow } from "../../theme/tokens";
import { Icon } from "./Icon";
import { focusRingProps, selectionHaptic, usePressFeedback } from "./interaction";
import { Skeleton } from "./Skeleton";
import { Meta } from "./Type";

/** The fields a tile needs; any Item satisfies it. */
export type TileItem = Pick<Item, "id" | "name" | "tags" | "cutout_path">;

export type TileSize = "grid" | "hero" | "mini";

/**
 * Space under a grid tile's image taken by its caption: 8 gap + body-sm line (22) + meta line (18). MasonryGrid
 * needs it up front to know every tile's height before anything renders.
 */
export const TILE_CAPTION_HEIGHT = 8 + 22 + 18;

// DESIGN.md: grid tiles radius 6 with 12 padding; small images radius 2; the item hero has no radius.
export const FRAME = {
  grid: { radius: 6, pad: 12 },
  hero: { radius: 0, pad: 24 },
  mini: { radius: 2, pad: 8 },
} as const satisfies Record<TileSize, { radius: number; pad: number }>;

// Not at home: the garment is shown, but visibly not available (DESIGN.md section 3 "ארון" item 5).
const DIMMED_OPACITY = 0.45;
const RING = 2;
const IMAGE_FADE_MS = motion.stateMs;

type Props = {
  /** Omit only while loading. */
  item?: TileItem;
  size?: TileSize;
  /** Exact image-box width in px (MasonryGrid gives it). Without it the tile fills its parent's width. */
  width?: number;
  /** Height / width of the image box. Defaults to the garment type's aspect for grid, 1 for mini. */
  aspect?: number;
  /** Two lines under the image: name, then "type · colour" (or where the item is when not at home). */
  caption?: { title: string; meta: string };
  /** Chosen (reserve-duty picking): ink ring + check. */
  selected?: boolean;
  /** The tile is a checkbox (picking mode) rather than a link to the item. */
  toggle?: boolean;
  /** Not at home: the image drops to 0.45. */
  dimmed?: boolean;
  /** Reserve the final size in the tile tone and pulse; nothing else renders. */
  loading?: boolean;
  onPress?: () => void;
  /** DESIGN.md section 3: long press opens the item's action sheet. Every long-press action must also exist elsewhere. */
  onLongPress?: () => void;
  /** Defaults to the item's name (DESIGN.md section 6: an item image is labelled with its name). */
  accessibilityLabel?: string;
  /**
   * The image box's node (not the caption), for the shared-element flight to the item screen: the caller measures
   * it on press and registers it so the item screen can fly back to it.
   */
  imageRef?: (node: ComponentRef<typeof View> | null) => void;
};

/** Web keys that conventionally open an element's context menu; the keyboard path to `onLongPress`. */
const isMenuKey = (e: { key?: string; shiftKey?: boolean }) => e.key === "ContextMenu" || (e.key === "F10" && e.shiftKey === true);

/**
 * Item tile: a neutral ground chosen by the garment's colour (tileTone), the cutout `contain`ed with padding, no
 * frame. Without a photo it shows the item's drawing (ItemArt), exactly as the existing grid does. Press = scale
 * 0.97 and `shadow.lift` fading in beneath, 120ms; that is the only time a tile has a shadow.
 */
export function Tile({
  item,
  size = "grid",
  width,
  aspect,
  caption,
  selected = false,
  toggle = false,
  dimmed = false,
  loading = false,
  onPress,
  onLongPress,
  accessibilityLabel,
  imageRef,
}: Props) {
  const { onPressIn, onPressOut, pressStyle, liftStyle } = usePressFeedback();
  const frame = FRAME[size];
  const tone = tileTone(item?.tags.color_hex);
  const ratio = aspect ?? (size === "mini" ? 1 : item ? tileAspect(item.tags.subcategory) : 1.25);
  const box = width !== undefined ? { width, height: width * ratio } : { width: "100%" as const, aspectRatio: 1 / ratio };

  if (loading || !item) {
    return (
      <View>
        <View style={box}>
          <Skeleton height="100%" tone={tone} radius={size === "grid" ? "md" : size === "mini" ? "sm" : "none"} />
        </View>
        {caption ? <View style={{ height: TILE_CAPTION_HEIGHT }} /> : null}
      </View>
    );
  }

  const image = item.cutout_path ? (
    <Image
      source={{ uri: cutoutUrl(item.cutout_path) }}
      contentFit="contain"
      cachePolicy="memory-disk"
      // don't touch / recycled cells (windowed grid) would otherwise flash the previous item's image.
      recyclingKey={item.id}
      transition={{ duration: IMAGE_FADE_MS, effect: "cross-dissolve" }}
      style={{ width: "100%", height: "100%" }}
      accessibilityIgnoresInvertColors
    />
  ) : (
    <ItemArt tags={item.tags} />
  );

  const label = accessibilityLabel ?? item.name;
  const interactive = onPress !== undefined || onLongPress !== undefined;

  const body = (
    <Animated.View style={pressStyle}>
      {/* collapsable false: Android would otherwise flatten the box away and there would be nothing to measure. */}
      <View ref={imageRef} collapsable={false} style={box}>
        {/* Shadow layer: same shape as the tile, invisible at rest (DESIGN.md section 1: no shadow at rest). */}
        <Animated.View
          style={[{ position: "absolute", top: 0, bottom: 0, start: 0, end: 0, borderRadius: frame.radius, backgroundColor: colors[tone] }, shadow.lift, liftStyle]}
        />
        <View style={{ flex: 1, borderRadius: frame.radius, backgroundColor: colors[tone], padding: frame.pad }}>
          <View style={{ flex: 1, opacity: dimmed ? DIMMED_OPACITY : 1 }}>{image}</View>
        </View>
        {selected ? (
          <>
            <View
              pointerEvents="none"
              style={{ position: "absolute", top: 0, bottom: 0, start: 0, end: 0, borderRadius: frame.radius, borderWidth: RING, borderColor: colors.ink }}
            />
            <View pointerEvents="none" className="absolute end-2 top-2 items-center justify-center rounded-sm bg-ink" style={{ width: 24, height: 24 }}>
              <Icon name="check" color="ivory" />
            </View>
          </>
        ) : null}
      </View>
      {caption ? (
        // don't touch / start-aligned box, not text alignment: react-native-web gives text dir="auto", so a Latin item
        // name ("Kenneth Cole Coat") hugged the left edge of an RTL tile. maxWidth keeps the one-line ellipsis.
        <View className="mt-2" style={{ height: TILE_CAPTION_HEIGHT - 8, alignItems: "flex-start" }}>
          <Text className="font-body text-body-sm text-ink" numberOfLines={1} style={{ maxWidth: "100%" }}>
            {caption.title}
          </Text>
          <Meta numberOfLines={1} style={{ maxWidth: "100%" }}>
            {caption.meta}
          </Meta>
        </View>
      ) : null}
    </Animated.View>
  );

  if (!interactive) {
    return (
      <View accessible accessibilityRole="image" accessibilityLabel={label}>
        {body}
      </View>
    );
  }

  // Web: a long press has no keyboard or mouse equivalent of its own, so the context-menu key, Shift+F10 and a
  // right click open the same thing. Props only exist where react-native-web reads them.
  const webMenu: object =
    Platform.OS === "web" && onLongPress
      ? {
          onKeyDown: (e: { key?: string; shiftKey?: boolean; preventDefault?: () => void }) => {
            if (!isMenuKey(e)) return;
            e.preventDefault?.();
            onLongPress();
          },
          onContextMenu: (e: { preventDefault?: () => void }) => {
            e.preventDefault?.();
            onLongPress();
          },
        }
      : {};

  return (
    <Pressable
      {...focusRingProps}
      {...webMenu}
      onPress={
        onPress
          ? () => {
              selectionHaptic();
              onPress();
            }
          : undefined
      }
      onLongPress={
        onLongPress
          ? () => {
              selectionHaptic();
              onLongPress();
            }
          : undefined
      }
      onPressIn={onPressIn}
      onPressOut={onPressOut}
      accessibilityRole={toggle ? "checkbox" : "button"}
      accessibilityLabel={label}
      accessibilityState={toggle ? { checked: selected } : { selected }}
      // Screen readers cannot long-press reliably; expose it as the standard action too (DESIGN.md section 6).
      accessibilityActions={onLongPress ? [{ name: "longpress" }] : undefined}
      onAccessibilityAction={(e) => {
        if (e.nativeEvent.actionName === "longpress") onLongPress?.();
      }}
    >
      {body}
    </Pressable>
  );
}
