import { useEffect, useRef, type RefObject } from "react";
import { Platform } from "react-native";

const TABBABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Painted and not inside a hidden tab scene: something a keyboard user can actually land on. */
function reachable(el: Element | null): el is HTMLElement {
  return el instanceof HTMLElement && el.isConnected && el.getClientRects().length > 0 && el.closest("[data-scene-hidden], [inert]") === null;
}

/**
 * Props for the view that holds the tabs (bar and scenes) while a modal route (item, location, archive) is on top of
 * it: out of the keyboard order and the accessibility tree, but still painted, because the item screen's page fades
 * in over it and its flight starts from a picture in it (DESIGN.md section 5). `visibility` or `display` would blank
 * it. Web: `inert` (no focus, no clicks, no accessibility node) plus `aria-hidden` for older assistive tech; native:
 * the two platform flags that hide a subtree from VoiceOver and TalkBack.
 * @param covered whether a modal route is on top of the tabs.
 */
export function underModalProps(covered: boolean): object {
  if (!covered) return {};
  return Platform.OS === "web"
    ? { inert: true, "aria-hidden": true }
    : { importantForAccessibility: "no-hide-descendants", accessibilityElementsHidden: true };
}

/**
 * Web: when the modal route above the tabs goes away, focus comes back to the control that opened it (a wardrobe
 * tile, a Today garment, a profile row) when it is still on screen, else to the selected screen's first focusable
 * element. Without this a keyboard Back from the item screen left focus on `<body>` (verification N3): the opener was
 * inert while the modal was up, and the Back button that had focus was unmounted with the route.
 * @param root the element holding every tab scene (and the bar); scenes are marked `data-scene` by SceneGate.
 * @param covered whether a modal route is on top of the tabs now.
 */
export function useFocusReturnUnderModal(root: RefObject<unknown>, covered: boolean): void {
  const last = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (Platform.OS !== "web") return;
    const el = root.current;
    if (!(el instanceof HTMLElement)) return;
    // The opener is the last element focused inside the tabs before the modal covered them: Enter or a click on a
    // tile focuses it first. Read continuously, because `inert` drops the focus before any effect could look.
    const onIn = (e: FocusEvent) => {
      if (e.target instanceof HTMLElement) last.current = e.target;
    };
    el.addEventListener("focusin", onIn);
    return () => el.removeEventListener("focusin", onIn);
  }, [root]);

  const wasCovered = useRef(covered);
  useEffect(() => {
    const uncovered = wasCovered.current && !covered;
    wasCovered.current = covered;
    if (Platform.OS !== "web" || !uncovered) return;
    // Next frame: the modal route unmounts (and its focused Back button with it) in the same commit as this effect.
    const frame = requestAnimationFrame(() => {
      const el = root.current;
      if (!(el instanceof HTMLElement)) return;
      const at = document.activeElement;
      // Something inside the tabs already has focus (a click landed during the flight back): leave it.
      if (at instanceof HTMLElement && at !== document.body && el.contains(at)) return;
      const opener = last.current;
      const target = reachable(opener) && el.contains(opener) ? opener : (sameControl(el, opener) ?? firstFocusable(el));
      target?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [covered, root]);
}

/**
 * The opener's stand-in when its node was replaced meanwhile: an edit on the item screen re-renders the wardrobe, and
 * the masonry rebuilt the tile, so the remembered node was detached although the same tile is on screen. Matched by
 * role and spoken name inside the selected scene; null when the opener is truly gone.
 */
function sameControl(root: HTMLElement, opener: HTMLElement | null): HTMLElement | null {
  const label = opener?.getAttribute("aria-label");
  if (!opener || !label) return null;
  const scene = root.querySelector<HTMLElement>("[data-scene]:not([data-scene-hidden])");
  const role = opener.getAttribute("role");
  const pool = Array.from((scene ?? root).querySelectorAll<HTMLElement>(role ? `[role="${role}"]` : opener.tagName));
  return pool.find((el) => el.getAttribute("aria-label") === label && reachable(el)) ?? null;
}

/** The first focusable element of the selected scene (not the bar): "the screen's first focusable element". */
function firstFocusable(root: HTMLElement): HTMLElement | null {
  const scene = root.querySelector<HTMLElement>("[data-scene]:not([data-scene-hidden])");
  const pool = Array.from((scene ?? root).querySelectorAll<HTMLElement>(TABBABLE));
  return pool.find(reachable) ?? null;
}
