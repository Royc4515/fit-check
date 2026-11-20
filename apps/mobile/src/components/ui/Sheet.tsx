import { useEffect, useId, useLayoutEffect, useRef, useState, type ComponentRef, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Modal, Platform, Pressable, ScrollView, Text, View, useWindowDimensions } from "react-native";
import { GestureDetector, GestureHandlerRootView, usePanGesture } from "react-native-gesture-handler";
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withSpring, withTiming } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { scheduleOnRN } from "react-native-worklets";
import { colors, layout, motion, shadow } from "../../theme/tokens";
import { Button } from "./Button";
import { timing } from "./interaction";
import { headingProps } from "./Type";

type Props = {
  open: boolean;
  /** Called for every dismissal (scrim, drag, Escape, Android back, close button). The parent sets `open` false. */
  onClose: () => void;
  title?: string;
  /** Required when there is no title: the dialog needs a name for screen readers. */
  accessibilityLabel?: string;
  /** Pinned below the scrolling content (e.g. "clear" / "show N items"). */
  footer?: ReactNode;
  /**
   * Pinned between the title row and the scrolling content (a picker's search field): stays in view while the list
   * scrolls. Not chrome: its first control is where focus goes when the sheet opens.
   */
  subheader?: ReactNode;
  /**
   * Always as tall as a sheet may be (85% of the window), whatever the content: a picker whose list shrinks as the
   * user types must not make the sheet jump under the finger.
   */
  tall?: boolean;
  children: ReactNode;
};

/** Sheets never cover more than this share of the window; taller content scrolls inside. */
const MAX_HEIGHT_SHARE = 0.85;
/** DESIGN.md section 5: release past 30% of the sheet's height closes it. */
const DISMISS_SHARE = 0.3;
/** Seconds of the finger's velocity added on release, so a fling closes even from a short drag. */
const PROJECTION_S = 0.15;
const HANDLE_W = 32;
const HANDLE_H = 4;
/** Desktop dialog entrance: 8px rise with the fade (DESIGN.md section 5 generic motion). */
const RISE = 8;

/** Web markers read by `firstFocus`. Typed object spreads: RN's types have no `dataSet`, react-native-web reads it. */
const chromeProps: object = Platform.OS === "web" ? { dataSet: { sheetChrome: "" } } : {};
const titleProps: object = Platform.OS === "web" ? { dataSet: { sheetTitle: "" } } : {};

const TABBABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Painted, connected and not under an inert or hidden ancestor: somewhere focus can really go. */
function reachable(el: Element | null | undefined): el is HTMLElement {
  return el instanceof HTMLElement && el.isConnected && el.getClientRects().length > 0 && el.closest("[inert], [data-scene-hidden]") === null;
}

/**
 * Web focus bookkeeping of one open sheet. `openers` is where focus goes back on close, best first: the element that
 * had focus when the sheet opened, then (when that element sat in another sheet, e.g. the item's "more" sheet that
 * opened the redraw composer and closed) that sheet's own openers, since the row is gone by the time this one closes.
 */
type FocusRecord = { openers: HTMLElement[]; dialog: HTMLElement | null; last: HTMLElement | null };
/** Sheets on screen now (open or closing), oldest first. A closing sheet only restores focus when no other is open. */
const openSheets: FocusRecord[] = [];
const unregister = (record: FocusRecord) => {
  const i = openSheets.indexOf(record);
  if (i !== -1) openSheets.splice(i, 1);
};

/**
 * Web only. react-native-web's Modal already renders the one `role="dialog" aria-modal` element (it takes our
 * `aria-label` / `aria-labelledby`) and traps focus with two empty `tabindex=0` sentinel divs on either side of it.
 * Those sentinels are focusable, unnamed content for a screen reader, so they are taken out of the tab order and the
 * accessibility tree, and the wrap-around they provided is done on Tab / Shift+Tab inside the dialog instead.
 * First focus goes to the first control of the sheet's content (not the close button, not the footer, whose first
 * button may be a paid or destructive confirm), else to the title; never to the dialog element, whose focus ring
 * framed the whole viewport (verification N6). RNW's own focus listener still pulls back any focus that escapes by
 * mouse or script.
 * @param inner A node inside the Modal's dialog; anything that is not an element (native, not yet mounted) is ignored.
 * @param record this sheet's focus bookkeeping; gets the dialog and every later focus inside it.
 * @returns a function that removes the listeners, or undefined when nothing was adopted.
 */
function adoptModalDialog(inner: unknown, record: FocusRecord): (() => void) | undefined {
  if (!(inner instanceof HTMLElement)) return undefined;
  // don't touch / matched by `aria-modal`, not `role="dialog"`: RNW only sets the role once its Modal reports itself
  // active, which is after this runs.
  const dialog = inner.closest<HTMLElement>('[aria-modal="true"]');
  if (!dialog) return undefined;
  // don't touch / the sentinels must stay in the DOM (RNW renders them, as role=presentation tabindex=0 siblings of
  // the dialog's wrapper) but must not be reachable or announced.
  dialog.parentElement?.parentElement?.querySelectorAll<HTMLElement>(':scope > [role="presentation"][tabindex]').forEach((s) => {
    s.setAttribute("tabindex", "-1");
    s.setAttribute("aria-hidden", "true");
  });
  dialog.tabIndex = -1;
  // Script or RNW's trap may still focus the host; it must not draw a ring around the viewport when it does.
  dialog.style.outline = "none";
  record.dialog = dialog;
  firstFocus(dialog)?.focus();
  const onFocusIn = (e: FocusEvent) => {
    if (e.target instanceof HTMLElement && e.target !== dialog) record.last = e.target;
  };
  dialog.addEventListener("focusin", onFocusIn);
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key !== "Tab") return;
    const stops = Array.from(dialog.querySelectorAll<HTMLElement>(TABBABLE)).filter((el) => el.getClientRects().length > 0);
    const first = stops[0];
    const last = stops[stops.length - 1];
    if (!first || !last) {
      e.preventDefault();
      return;
    }
    const at = document.activeElement;
    if (e.shiftKey && (at === first || at === dialog)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && at === last) {
      e.preventDefault();
      first.focus();
    }
  };
  dialog.addEventListener("keydown", onKeyDown);
  return () => {
    dialog.removeEventListener("keydown", onKeyDown);
    dialog.removeEventListener("focusin", onFocusIn);
  };
}

/** The first control of a sheet's content (header and footer excluded), else its title made focusable without a ring. */
function firstFocus(dialog: HTMLElement): HTMLElement | null {
  const control = Array.from(dialog.querySelectorAll<HTMLElement>(TABBABLE)).find((el) => reachable(el) && el.closest("[data-sheet-chrome]") === null);
  if (control) return control;
  const title = dialog.querySelector<HTMLElement>("[data-sheet-title]");
  if (!title || !title.textContent) return null;
  title.tabIndex = -1;
  title.style.outline = "none";
  return title;
}

/**
 * The element that has focus as a sheet opens, with the openers of the sheet it sits in (if any) behind it.
 */
function openersFor(at: Element | null): HTMLElement[] {
  if (!(at instanceof HTMLElement) || at === document.body) return [];
  const host = at.closest<HTMLElement>('[aria-modal="true"]');
  const outer = host ? openSheets.find((r) => r.dialog === host) : undefined;
  return [at, ...(outer?.openers ?? [])];
}

/**
 * A sheet has closed: if another sheet is still open, focus stays (or goes back) inside it, at its last focused
 * control; otherwise it returns to the first opener still on screen. Next frame: react-native-web's Modal restores
 * focus on unmount to whatever was focused when it mounted, which for a sheet opened from another sheet is a row that
 * no longer exists, or a control behind the sheet that is still open (verification N4).
 */
function restoreFocus(record: FocusRecord): void {
  unregister(record);
  requestAnimationFrame(() => {
    const top = openSheets[openSheets.length - 1];
    if (top) {
      const at = document.activeElement;
      if (top.dialog && at instanceof Node && top.dialog.contains(at) && at !== top.dialog) return;
      const target = reachable(top.last) ? top.last : top.dialog ? firstFocus(top.dialog) : null;
      target?.focus();
      return;
    }
    record.openers.find((el) => reachable(el))?.focus();
  });
}

/**
 * Bottom sheet (DESIGN.md sections 4-5). Rendered in a transparent RN `Modal`, so it sits above the tab bar and
 * every screen on native, and on web gets react-native-web's Escape handling and focus trap. Focus return is ours on
 * web: to the opener, or to the opener of the sheet the opener sat in when that one closed meanwhile.
 *
 * Phone: slides up on `motion.spring` (critically damped, no overshoot); drag the handle (or the whole sheet when
 * its content fits) to dismiss: release past 30% or a fling closes, continuing at the finger's velocity. Scrim tap
 * closes. Width >= 900: a centred 480 dialog that fades in with an 8px rise, no drag. Reduced motion: fade only.
 * All motion is shared values on the UI thread; React state changes only on mount/unmount.
 */
export function Sheet({ open, onClose, title, accessibilityLabel, footer, subheader, tall = false, children }: Props) {
  const { t } = useTranslation();
  const titleId = useId();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const reduce = useReducedMotion();
  const desktop = width >= layout.desktopMin;
  const sliding = !desktop && !reduce;

  // Stays true through the closing animation; the Modal unmounts only when that animation finishes.
  const [mounted, setMounted] = useState(open);
  const [scrollable, setScrollable] = useState(false);
  const panel = useRef<ComponentRef<typeof View>>(null);
  // Web focus bookkeeping for this sheet while it is open (see FocusRecord); null while closed.
  const focusRecord = useRef<FocusRecord | null>(null);
  // don't touch / web: a sheet opened by a touch long press appears under the finger, and the browser's click on
  // release lands on the scrim and closed it at once. Only a press that also started on the scrim closes the sheet.
  const scrimPressed = useRef(false);
  // The scroll view shrinks to fit (flexShrink) once the sheet hits its cap; content taller than it = scrolling.
  const size = useRef({ viewport: 0, content: 0 });
  const measureScroll = () => {
    const { viewport, content } = size.current;
    if (viewport > 0 && content > 0) setScrollable(content > viewport + 1);
  };

  // Phone: translateY of the panel (0 = open). Starts a full window down: offscreen whatever the sheet's height.
  const y = useSharedValue(height);
  const sheetH = useSharedValue(height);
  const startY = useSharedValue(0);
  const releaseV = useSharedValue(0);
  // Desktop / reduced motion: 0..1 fade.
  const fade = useSharedValue(0);

  // Derived during render, not in an effect: the Modal mounts in the same commit that `open` turns true.
  if (open && !mounted) setMounted(true);

  // don't touch / a layout effect: it runs before react-native-web's Modal moves focus into the new dialog (its
  // effects are passive), so `document.activeElement` is still the control that opened this sheet.
  // A sheet stays registered until it has left the screen: a sheet opened from it meanwhile (the item's "more" sheet
  // opening the composer as it closes) still finds it, and with it the control that opened it.
  useLayoutEffect(() => {
    if (Platform.OS !== "web" || !open) return;
    const reopened = focusRecord.current;
    const record: FocusRecord = { openers: reopened?.openers ?? openersFor(document.activeElement), dialog: null, last: null };
    if (reopened) unregister(reopened);
    focusRecord.current = record;
    openSheets.push(record);
  }, [open]);

  // Focus goes back once the sheet has left the screen (its closing animation done), or when it unmounts while open.
  useEffect(() => {
    if (Platform.OS !== "web" || mounted) return;
    const record = focusRecord.current;
    focusRecord.current = null;
    if (record) restoreFocus(record);
  }, [mounted]);
  useEffect(() => {
    const holder = focusRecord;
    return () => {
      const record = holder.current;
      holder.current = null;
      if (Platform.OS === "web" && record) restoreFocus(record);
    };
  }, []);

  useEffect(() => {
    if (!mounted) return;
    const finish = (finished?: boolean) => {
      "worklet";
      if (finished) scheduleOnRN(setMounted, false);
    };
    if (open) {
      if (sliding) y.set(withSpring(0, motion.spring));
      else fade.set(withTiming(1, timing(motion.stateMs)));
      // Move focus into the dialog so keyboard users start inside it (RNW's trap keeps it there).
      // don't touch / next frame, not now: react-native-web's Modal portal attaches its content after this effect,
      // so `panel.current` is still null in the same tick and focus silently stayed on the opener.
      if (Platform.OS === "web") {
        let release: (() => void) | undefined;
        const frame = requestAnimationFrame(() => {
          const record = focusRecord.current;
          if (record) release = adoptModalDialog(panel.current, record);
        });
        return () => {
          cancelAnimationFrame(frame);
          release?.();
        };
      }
    } else if (sliding) {
      const v = releaseV.get();
      releaseV.set(0);
      y.set(withSpring(sheetH.get(), { ...motion.spring, velocity: v }, finish));
    } else {
      fade.set(withTiming(0, timing(motion.stateMs), finish));
    }
  }, [open, mounted, sliding, y, fade, sheetH, releaseV]);

  const activeOffsetY: [number, number] = [-8, 8];
  const onBegin = () => {
    "worklet";
    startY.set(y.get());
  };
  const onUpdate = (e: { translationY: number }) => {
    "worklet";
    // No pulling above fully open: the spring has no overshoot and neither does the finger.
    y.set(Math.max(0, startY.get() + e.translationY));
  };
  const onDeactivate = (e: { velocityY: number }) => {
    "worklet";
    const projected = y.get() + e.velocityY * PROJECTION_S;
    if (projected > sheetH.get() * DISMISS_SHARE) {
      // The close animation (in the effect above) picks this up, so the sheet leaves at the finger's speed.
      releaseV.set(e.velocityY);
      scheduleOnRN(onClose);
    } else {
      y.set(withSpring(0, { ...motion.spring, velocity: e.velocityY }));
    }
  };
  // don't touch / no `...config` spread in these calls: the worklets Babel plugin rejects spread arguments to gesture
  // hooks and the whole web build fails.
  const panHandle = usePanGesture({ activeOffsetY, onBegin, onUpdate, onDeactivate, enabled: sliding });
  // Whole-sheet drag only when nothing inside scrolls; otherwise the scroll view owns vertical drags.
  const panBody = usePanGesture({ activeOffsetY, onBegin, onUpdate, onDeactivate, enabled: sliding && !scrollable });

  const scrimStyle = useAnimatedStyle(() => ({
    opacity: sliding ? Math.min(1, Math.max(0, 1 - y.get() / Math.max(1, sheetH.get()))) : fade.get(),
  }));
  const panelStyle = useAnimatedStyle(() =>
    sliding
      ? { transform: [{ translateY: y.get() }] }
      : { opacity: fade.get(), transform: [{ translateY: reduce ? 0 : (1 - fade.get()) * RISE }] }
  );

  if (!mounted) return null;

  const maxH = height * MAX_HEIGHT_SHARE;
  const name = title ?? accessibilityLabel;
  // The dialog's name: the visible title when there is one (so what is read is what is seen), else the label.
  // A typed object spread: RN's Modal types have no aria props, but react-native-web forwards them to its dialog.
  const modalWebProps: { "aria-labelledby"?: string; "aria-label"?: string } =
    Platform.OS !== "web" ? {} : title ? { "aria-labelledby": titleId } : { "aria-label": name };

  // Header and footer are "chrome" for first focus: it skips the close button and a footer's confirm (firstFocus).
  const header = (
    <View {...chromeProps}>
      {desktop ? null : (
        <View className="items-center pt-2 pb-1">
          <View className="rounded-sm bg-ink-faint" style={{ width: HANDLE_W, height: HANDLE_H }} />
        </View>
      )}
      <View className="flex-row items-center ps-5 pe-2" style={{ minHeight: layout.hit }}>
        {/* don't touch / start-aligned box, not text alignment: react-native-web gives text dir="auto", so a Latin
            title ("Benetton Polo") hugged the close button's edge in an RTL sheet. */}
        <View style={{ flex: 1, alignItems: "flex-start" }}>
          <Text nativeID={titleId} {...titleProps} {...headingProps(2)} className="font-body-semibold text-title text-ink" numberOfLines={1} style={{ maxWidth: "100%" }}>
            {title ?? ""}
          </Text>
        </View>
        {/* Every gesture also exists as a button (DESIGN.md section 6): drag and scrim tap have this. */}
        <Button variant="icon" icon="close" accessibilityLabel={t("ui.close")} onPress={onClose} />
      </View>
    </View>
  );

  const body = (
    <ScrollView
      scrollEnabled={scrollable}
      style={{ flexGrow: 0, flexShrink: 1 }}
      contentContainerStyle={{ paddingHorizontal: layout.gutter, paddingBottom: footer ? 16 : 24 + (desktop ? 0 : insets.bottom) }}
      onLayout={(e) => {
        size.current.viewport = e.nativeEvent.layout.height;
        measureScroll();
      }}
      onContentSizeChange={(_, h) => {
        size.current.content = h;
        measureScroll();
      }}
    >
      {children}
    </ScrollView>
  );

  const content = (
    <>
      {sliding ? <GestureDetector gesture={panHandle}>{header}</GestureDetector> : header}
      {subheader ? <View style={{ paddingHorizontal: layout.gutter, paddingBottom: 8 }}>{subheader}</View> : null}
      {sliding ? (
        <GestureDetector gesture={panBody}>
          <View style={{ flexShrink: 1 }}>{body}</View>
        </GestureDetector>
      ) : (
        body
      )}
      {footer ? (
        <View {...chromeProps} className="border-t border-hairline px-5 pt-4" style={{ paddingBottom: 16 + (desktop ? 0 : insets.bottom) }}>
          {footer}
        </View>
      ) : null}
    </>
  );

  return (
    <Modal
      {...modalWebProps}
      transparent
      visible
      animationType="none"
      onRequestClose={onClose}
      statusBarTranslucent
      navigationBarTranslucent
    >
      {/* don't touch / Android: gestures inside a Modal need their own root view, the app's root does not reach it. */}
      <GestureHandlerRootView style={{ flex: 1 }}>
        <View style={{ flex: 1, justifyContent: desktop ? "center" : "flex-end", alignItems: desktop ? "center" : "stretch" }}>
          <Animated.View style={[{ position: "absolute", top: 0, bottom: 0, start: 0, end: 0 }, scrimStyle]}>
            <Pressable
              onPressIn={() => (scrimPressed.current = true)}
              onPress={() => {
                if (scrimPressed.current) onClose();
                scrimPressed.current = false;
              }}
              focusable={false}
              // don't touch / the scrim is a mouse target only. On the web `focusable={false}` still leaves it a
              // tabindex=0 unnamed div, so it is also taken out of the tab order and hidden from the tree.
              tabIndex={-1}
              aria-hidden
              accessibilityElementsHidden
              importantForAccessibility="no"
              style={{ flex: 1, backgroundColor: colors.scrim }}
            />
          </Animated.View>
          <Animated.View style={[{ width: desktop ? Math.min(layout.dialogWidth, width - 2 * layout.gutter) : "100%" }, panelStyle]}>
            <View
              ref={panel}
              accessibilityViewIsModal
              // Native: the panel is the dialog. On the web the Modal's own element is (see modalWebProps).
              accessibilityLabel={Platform.OS === "web" ? undefined : name}
              onLayout={(e) => sheetH.set(e.nativeEvent.layout.height)}
              className={`border-hairline bg-ivory ${desktop ? "rounded-lg border" : "rounded-t-lg border-t"}`}
              style={[{ maxHeight: maxH, overflow: "hidden" }, tall ? { height: maxH } : null, shadow.sheet]}
            >
              {content}
            </View>
          </Animated.View>
        </View>
      </GestureHandlerRootView>
    </Modal>
  );
}
