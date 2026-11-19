import { useCallback, useRef } from "react";
import { Platform } from "react-native";
import { useRtl } from "./interaction";

/** The part of a DOM keyboard event the group needs. react-native-web hands the DOM event through unchanged. */
type KeyEvent = { key: string; preventDefault: () => void; altKey?: boolean; ctrlKey?: boolean; metaKey?: boolean };
type Focusable = { focus?: () => void } | null;

/**
 * Keyboard pattern of a group that is one tab stop (WAI-ARIA radiogroup and tablist), web only; native has no
 * keyboard focus to move and returns empty props.
 *
 * Roving tabindex: only the active item is tabbable (`tabIndex` 0, the rest -1), so Tab enters the group once and
 * leaves it, instead of stopping on every segment. Arrows move to the neighbour and wrap at the ends; Home / End
 * jump to the ends. Horizontal arrows are read in reading order: in a right-to-left layout the next item is on the
 * left, so ArrowLeft goes forward there. Up / Down always go back / forward (a vertical key has no mirror).
 *
 * @param count number of items.
 * @param activeIndex index of the chosen item (radios: the checked one; tabs: the selected one).
 * @param onMove called with the index to activate. Both patterns here activate as the focus arrives (radios must:
 * arrow keys select in a radiogroup; tabs: automatic activation, the content under them is cheap to re-filter).
 * @param disabled true = no handlers, nothing is focusable.
 */
export function useRovingGroup(count: number, activeIndex: number, onMove: (index: number) => void, disabled = false) {
  const rtl = useRtl();
  const refs = useRef<Focusable[]>([]);

  const move = useCallback(
    (to: number) => {
      onMove(to);
      // Focus follows, or the next key press would land on the item that is no longer the tab stop.
      refs.current[to]?.focus?.();
    },
    [onMove]
  );

  const itemProps = (index: number): object => {
    if (Platform.OS !== "web") return {};
    return {
      ref: (node: Focusable) => {
        refs.current[index] = node;
      },
      // A group with nothing chosen (not the case today) would still be reachable through its first item.
      tabIndex: disabled ? -1 : index === (activeIndex >= 0 ? activeIndex : 0) ? 0 : -1,
      onKeyDown: (e: KeyEvent) => {
        if (disabled || e.altKey || e.ctrlKey || e.metaKey) return;
        let to: number;
        switch (e.key) {
          case "ArrowRight":
            to = index + (rtl ? -1 : 1);
            break;
          case "ArrowLeft":
            to = index + (rtl ? 1 : -1);
            break;
          case "ArrowDown":
            to = index + 1;
            break;
          case "ArrowUp":
            to = index - 1;
            break;
          case "Home":
            to = 0;
            break;
          case "End":
            to = count - 1;
            break;
          case " ":
            // Enter already presses the item (Pressable); Space does not for a radio or a tab, and would scroll the page.
            e.preventDefault();
            onMove(index);
            return;
          default:
            return;
        }
        e.preventDefault();
        move((to + count) % count);
      },
    };
  };

  return { itemProps };
}
