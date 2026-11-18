import { useEffect, type ComponentRef, type RefObject } from "react";
import { Platform, View } from "react-native";

/**
 * Takes the focusable descendants of `ref` out of the web keyboard tab order (tabindex -1). They stay clickable and
 * stay in the accessibility tree; only Tab skips them. No-op off the web and when the node is not a DOM element.
 *
 * Why it exists: the hero's garments are painted in z-order (layer, bottom, top, shoes), so Tab walked them as
 * 04, 02, 01, 03, and each garment was a second stop next to its legend row. The legend rows are already in the
 * printed 01..04 order and open the same sheet, so the hero stops are duplicates. The proper fix is a prop on
 * FlatLay that sets `focusable={false}` on its Pressables; until that exists this does it from outside.
 * A MutationObserver re-applies it because a garment remounts (new node, tabindex back to 0) when the outfit changes.
 *
 * Failure modes: none that surface; a missing node or observer just leaves Tab order as it was.
 */
export function useOutOfTabOrder(ref: RefObject<ComponentRef<typeof View> | null>, active: boolean) {
  useEffect(() => {
    if (Platform.OS !== "web" || !active) return;
    // react-native-web hands out the DOM element as the View ref.
    const node: unknown = ref.current;
    if (typeof Element === "undefined" || !(node instanceof Element)) return;
    const apply = () => {
      node.querySelectorAll<HTMLElement>('[tabindex="0"]').forEach((el) => el.setAttribute("tabindex", "-1"));
    };
    apply();
    const observer = new MutationObserver(apply);
    observer.observe(node, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [ref, active]);
}
