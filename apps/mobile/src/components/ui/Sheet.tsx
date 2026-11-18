import { useEffect, useId, useRef, useState, type ComponentRef, type ReactNode } from "react";
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

const TABBABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Web only. react-native-web's Modal already renders the one `role="dialog" aria-modal` element (it takes our
 * `aria-label` / `aria-labelledby`) and traps focus with two empty `tabindex=0` sentinel divs on either side of it.
 * Those sentinels are focusable, unnamed content for a screen reader, so they are taken out of the tab order and the
 * accessibility tree, and the wrap-around they provided is done on Tab / Shift+Tab inside the dialog instead.
 * Focus then moves to the dialog element itself, which now carries the name (a second inner node would be a second
 * unnamed dialog). RNW's own focus listener still pulls back any focus that escapes by mouse or script.
 * @param inner A node inside the Modal's dialog; anything that is not an element (native, not yet mounted) is ignored.
 * @returns a function that removes the key handler, or undefined when nothing was adopted.
 */
function adoptModalDialog(inner: unknown): (() => void) | undefined {
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
  dialog.focus();
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
  return () => dialog.removeEventListener("keydown", onKeyDown);
}

/**
 * Bottom sheet (DESIGN.md sections 4-5). Rendered in a transparent RN `Modal`, so it sits above the tab bar and
 * every screen on native, and on web gets react-native-web's Escape handling, focus trap and focus return to the
 * opener for free.
 *
 * Phone: slides up on `motion.spring` (critically damped, no overshoot); drag the handle (or the whole sheet when
 * its content fits) to dismiss: release past 30% or a fling closes, continuing at the finger's velocity. Scrim tap
 * closes. Width >= 900: a centred 480 dialog that fades in with an 8px rise, no drag. Reduced motion: fade only.
 * All motion is shared values on the UI thread; React state changes only on mount/unmount.
 */
export function Sheet({ open, onClose, title, accessibilityLabel, footer, children }: Props) {
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
          release = adoptModalDialog(panel.current);
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

  const header = (
    <View>
      {desktop ? null : (
        <View className="items-center pt-2 pb-1">
          <View className="rounded-sm bg-ink-faint" style={{ width: HANDLE_W, height: HANDLE_H }} />
        </View>
      )}
      <View className="flex-row items-center ps-5 pe-2" style={{ minHeight: layout.hit }}>
        {/* don't touch / start-aligned box, not text alignment: react-native-web gives text dir="auto", so a Latin
            title ("Benetton Polo") hugged the close button's edge in an RTL sheet. */}
        <View style={{ flex: 1, alignItems: "flex-start" }}>
          <Text nativeID={titleId} {...headingProps(2)} className="font-body-semibold text-title text-ink" numberOfLines={1} style={{ maxWidth: "100%" }}>
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
      {sliding ? (
        <GestureDetector gesture={panBody}>
          <View style={{ flexShrink: 1 }}>{body}</View>
        </GestureDetector>
      ) : (
        body
      )}
      {footer ? (
        <View className="border-t border-hairline px-5 pt-4" style={{ paddingBottom: 16 + (desktop ? 0 : insets.bottom) }}>
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
              style={[{ maxHeight: maxH, overflow: "hidden" }, shadow.sheet]}
            >
              {content}
            </View>
          </Animated.View>
        </View>
      </GestureHandlerRootView>
    </Modal>
  );
}
