import { useCallback, type ComponentRef } from "react";
import type { View } from "react-native";
import { useAnimatedStyle, useSharedValue, type SharedValue } from "react-native-reanimated";

type Node = ComponentRef<typeof View>;

/** Pictures that can be the origin of the item screen's shared element, by the node a screen measures. */
// Weak: an unmounted node needs no cleanup, and a remounted picture simply registers its new node.
const pictures = new WeakMap<Node, SharedValue<number>>();

/**
 * Lets a library picture (Tile, FlatLay garment) be hidden while a shared-element copy of it is in flight, without
 * the library knowing about routes: the screen registers the node it measures, and the flight hides that node's
 * picture by the same node. Keyed by node, not item id, because one item can be on screen several times at once.
 * @param forward - the caller's own ref callback (e.g. Tile's `imageRef`), still called with every node.
 * @returns `attach`, a ref callback for the measured node, and the style for the picture inside it.
 */
export function useOriginVisibility(forward?: (node: Node | null) => void) {
  const shown = useSharedValue(1);
  const attach = useCallback(
    (node: Node | null) => {
      // Registered before the caller sees the node, so a flight that looks it up right away finds it.
      if (node) pictures.set(node, shown);
      forward?.(node);
    },
    [forward, shown]
  );
  const style = useAnimatedStyle(() => ({ opacity: shown.get() }));
  return { attach, style };
}

/**
 * Hides or shows the picture behind a measured node, at once (no fade: the flying copy covers it exactly).
 * A node that is not a library picture, or no longer mounted, is ignored.
 */
export function setOriginHidden(node: Node | null | undefined, hidden: boolean): void {
  if (!node) return;
  pictures.get(node)?.set(hidden ? 0 : 1);
}
