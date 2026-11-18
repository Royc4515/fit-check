import { useEffect, useMemo, useState, type ReactElement, type ReactNode } from "react";
import { ScrollView, View, useWindowDimensions, type StyleProp, type ViewStyle } from "react-native";
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withDelay, withTiming } from "react-native-reanimated";
import { layout as tokens, motion } from "../../theme/tokens";
import { timing, useRtl } from "./interaction";

export type MasonrySection<T> = {
  key: string;
  items: readonly T[];
  /** Rendered full width above the section's tiles, `sectionHeaderHeight` high (category name + count). */
  header?: ReactNode;
};

export type MasonryCellInfo = {
  /** Column width = the tile's width. */
  width: number;
  /** Image-box height (width × aspect), without the caption. */
  height: number;
  /** Position in layout order across all sections; stable for the same input. */
  index: number;
};

type LaidTile<T> = { kind: "tile"; key: string; item: T; x: number; y: number; w: number; h: number; index: number };
type LaidHeader = { kind: "header"; key: string; node: ReactNode; x: number; y: number; w: number; h: number };
export type MasonryLayout<T> = { cells: (LaidTile<T> | LaidHeader)[]; height: number };

export type MasonryInput<T> = {
  sections: readonly MasonrySection<T>[];
  width: number;
  columns: number;
  gap: number;
  rowGap: number;
  captionHeight: number;
  sectionHeaderHeight: number;
  sectionGap: number;
  keyOf: (item: T) => string;
  aspectOf: (item: T) => number;
};

/**
 * Pure masonry layout: each item goes into the currently shortest column (ties: the first column in reading
 * order), so the same input always gives the same picture. Heights come from `aspectOf` (known before images
 * load), which is what lets the grid reserve every tile's final place and never jump. x is measured from the
 * start edge; the renderer flips it for RTL.
 * @returns every tile and section header with its box, plus the total height. Empty sections are skipped.
 */
export function computeMasonry<T>(input: MasonryInput<T>): MasonryLayout<T> {
  const { width, gap, rowGap, captionHeight, sectionHeaderHeight, sectionGap, keyOf, aspectOf } = input;
  const columns = Math.max(1, Math.floor(input.columns));
  const colW = Math.max(0, (width - gap * (columns - 1)) / columns);
  const cells: MasonryLayout<T>["cells"] = [];
  let cursor = 0;
  let index = 0;
  let placedAny = false;
  for (const section of input.sections) {
    if (section.items.length === 0) continue;
    if (placedAny) cursor += sectionGap;
    placedAny = true;
    if (section.header !== undefined) {
      cells.push({ kind: "header", key: `section:${section.key}`, node: section.header, x: 0, y: cursor, w: width, h: sectionHeaderHeight });
      cursor += sectionHeaderHeight;
    }
    const cols = new Array<number>(columns).fill(cursor);
    for (const item of section.items) {
      let c = 0;
      for (let i = 1; i < columns; i++) if ((cols[i] ?? 0) < (cols[c] ?? 0)) c = i;
      const h = colW * aspectOf(item);
      const y = cols[c] ?? cursor;
      cells.push({ kind: "tile", key: keyOf(item), item, x: c * (colW + gap), y, w: colW, h, index: index++ });
      cols[c] = y + h + captionHeight + rowGap;
    }
    // The last row's trailing gap is not part of the section.
    cursor = Math.max(...cols) - rowGap;
  }
  return { cells, height: Math.max(0, cursor) };
}

type CellProps = {
  x: number;
  y: number;
  w: number;
  rtl: boolean;
  /** Present only for the first tiles of the first paint: entrance delay in ms. */
  enterDelay: number | undefined;
  children: ReactNode;
};

/**
 * One absolutely placed cell. Position is a transform on shared values, so a re-filter moves tiles to their new
 * places on the UI thread (280ms, transform only) without re-laying out anything.
 */
function Cell({ x, y, w, rtl, enterDelay, children }: CellProps) {
  const reduce = useReducedMotion();
  const tx = useSharedValue(x);
  const ty = useSharedValue(y);
  // Captured at mount: a later prop change must never replay the entrance (DESIGN.md section 5, item 2).
  const [delay] = useState(enterDelay);
  const shown = useSharedValue(delay === undefined ? 1 : 0);

  useEffect(() => {
    if (delay === undefined) return;
    shown.set(withDelay(reduce ? 0 : delay, withTiming(1, timing(motion.stateMs))));
  }, [delay, reduce, shown]);

  useEffect(() => {
    if (reduce) {
      tx.set(x);
      ty.set(y);
    } else {
      // On mount these animate from x to x: nothing moves. Only a real change of place is visible.
      tx.set(withTiming(x, timing(motion.layoutMs)));
      ty.set(withTiming(y, timing(motion.layoutMs)));
    }
  }, [x, y, reduce, tx, ty]);

  const style = useAnimatedStyle(() => ({
    opacity: shown.get(),
    transform: [{ translateX: rtl ? -tx.get() : tx.get() }, { translateY: ty.get() + (reduce ? 0 : (1 - shown.get()) * 8) }],
  }));
  // don't touch / anchored at `start`, then moved by transform: in RTL `start` is the right edge, so the x offset
  // is negated above. Inline style only: NativeWind ignores className on Reanimated views.
  return <Animated.View style={[{ position: "absolute", top: 0, start: 0, width: w }, style]}>{children}</Animated.View>;
}

type Props<T> = {
  /** A continuous grid. Ignored when `sections` is given. */
  items?: readonly T[];
  /** Groups with a header each ("All" in the wardrobe: one section per category). */
  sections?: readonly MasonrySection<T>[];
  /** Inner width of the grid in px. Needed up front: the layout is synchronous, never measured after paint. */
  width: number;
  /** See `masonryColumnsFor` in theme/tokens. */
  columns: number;
  /** Horizontal and vertical gap between tiles (default 8). */
  gap?: number;
  /** Fixed caption block under every tile (Tile's TILE_CAPTION_HEIGHT), 0 for bare tiles. */
  captionHeight?: number;
  /** Space between a caption and the next tile in the column (default 16 with captions, else `gap`). */
  rowGap?: number;
  sectionHeaderHeight?: number;
  /** Space between sections (default 48, DESIGN.md "בין סעיפים"). */
  sectionGap?: number;
  keyOf: (item: T) => string;
  /** Height / width of the tile's image box, e.g. `tileAspect(item.tags.subcategory)`. */
  aspectOf: (item: T) => number;
  renderItem: (item: T, info: MasonryCellInfo) => ReactNode;
  /** Scrolls with the grid, above it (screen header, filters). Measured; may change height freely. */
  ListHeaderComponent?: ReactElement;
  ListFooterComponent?: ReactElement;
  contentContainerStyle?: StyleProp<ViewStyle>;
};

/**
 * Pinterest-style masonry (DESIGN.md sections 3-5), virtualized.
 *
 * Why a windowed ScrollView and not FlatList/FlashList: masonry rows do not exist (each column has its own rhythm,
 * and sections break the flow), so a row-based list would need fake rows or a second layout pass. Every height is
 * known up front here, so the grid computes all positions synchronously, sizes one container to the exact total
 * height, and mounts only the cells whose box is within the viewport ± one screen. Scrolling changes React state
 * only when the window moves by half a screen. Same code on web and native, no measuring, no layout shift.
 *
 * Motion: first paint fades + rises the first 8 tiles, 40ms apart, once per mount. A changed item list moves the
 * mounted tiles to their new places in 280ms (transform only); tiles outside the window just appear in place.
 */
export function MasonryGrid<T>({
  items,
  sections,
  width,
  columns,
  gap = tokens.gridGap,
  captionHeight = 0,
  rowGap,
  sectionHeaderHeight = 0,
  sectionGap = 48,
  keyOf,
  aspectOf,
  renderItem,
  ListHeaderComponent,
  ListFooterComponent,
  contentContainerStyle,
}: Props<T>) {
  const rtl = useRtl();
  const window = useWindowDimensions();
  const [viewportH, setViewportH] = useState(0);
  const [gridTop, setGridTop] = useState(0);
  const [bucket, setBucket] = useState(0);

  const groups = useMemo<readonly MasonrySection<T>[]>(() => sections ?? [{ key: "all", items: items ?? [] }], [sections, items]);
  const laid = useMemo(
    () =>
      computeMasonry({
        sections: groups,
        width,
        columns,
        gap,
        rowGap: rowGap ?? (captionHeight > 0 ? 16 : gap),
        captionHeight,
        sectionHeaderHeight,
        sectionGap,
        keyOf,
        aspectOf,
      }),
    [groups, width, columns, gap, rowGap, captionHeight, sectionHeaderHeight, sectionGap, keyOf, aspectOf]
  );

  // First paint with tiles: remember which keys stagger in. Derived during render (not in an effect) so those tiles
  // mount already hidden; an effect would let them flash at full opacity for a frame.
  const [entrance, setEntrance] = useState<ReadonlyMap<string, number> | null>(null);
  if (entrance === null) {
    const first = laid.cells.filter((c): c is LaidTile<T> => c.kind === "tile" && c.index < motion.staggerMax);
    if (first.length > 0) setEntrance(new Map(first.map((c) => [c.key, c.index * motion.staggerMs])));
  }
  useEffect(() => {
    if (!entrance || entrance.size === 0) return;
    // Once the cascade is over, nothing may enter again (re-filter, scrolling back): an empty map, never null.
    const id = setTimeout(() => setEntrance(new Map()), motion.staggerMax * motion.staggerMs + motion.stateMs);
    return () => clearTimeout(id);
  }, [entrance]);

  const screen = viewportH > 0 ? viewportH : window.height;
  const step = screen / 2;
  // Window in grid coordinates: one screen above and below what is visible, plus the half-screen bucket step.
  const top = bucket * step - gridTop - screen;
  const bottom = bucket * step - gridTop + screen * 2 + step;
  const visible = laid.cells.filter((c) => c.y + c.h + captionHeight >= top && c.y <= bottom);

  return (
    <ScrollView
      onLayout={(e) => setViewportH(e.nativeEvent.layout.height)}
      onScroll={(e) => {
        const next = Math.max(0, Math.floor(e.nativeEvent.contentOffset.y / step));
        if (next !== bucket) setBucket(next);
      }}
      scrollEventThrottle={16}
      contentContainerStyle={contentContainerStyle}
    >
      {ListHeaderComponent}
      <View onLayout={(e) => setGridTop(e.nativeEvent.layout.y)} style={{ width, height: laid.height, alignSelf: "center" }}>
        {visible.map((c) =>
          c.kind === "header" ? (
            <Cell key={c.key} x={c.x} y={c.y} w={c.w} rtl={rtl} enterDelay={undefined}>
              <View style={{ height: c.h }}>{c.node}</View>
            </Cell>
          ) : (
            <Cell key={c.key} x={c.x} y={c.y} w={c.w} rtl={rtl} enterDelay={entrance?.get(c.key)}>
              {renderItem(c.item, { width: c.w, height: c.h, index: c.index })}
            </Cell>
          )
        )}
      </View>
      {ListFooterComponent}
    </ScrollView>
  );
}
