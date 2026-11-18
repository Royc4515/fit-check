import { useCallback, useEffect, useRef, useState } from "react";
import {
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withTiming,
} from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import { timing } from "../../components/ui/interaction";
import type { TileTone } from "../../theme/tileTone";
import { motion } from "../../theme/tokens";
import type { HeroGeometry } from "./geometry";
import { captureReturn, DEFAULT_ORIGIN_PAD, getFlightOrigin, type FlightOrigin, type Rect } from "./transition";

/** Text follows the page by this much so it never sits on top of the still-visible screen underneath. */
const CONTENT_DELAY_MS = 100;
/** The text leaves faster than the page: on the way back it should be gone before the picture lands. */
const CONTENT_EXIT_MS = 120;
/** On the way back the page fade (180ms) runs from 120ms to 300ms of the 420ms flight. */
const RETURN_FADE_DELAY_MS = (motion.screenMs - motion.stateMs) / 2;

type Box = { cx: number; cy: number; w: number; h: number };

/** A `contain`ed picture of height/width `aspect` inside `r`, centred. Unknown aspect (0) = the whole box. */
function fit(r: Rect, aspect: number): Box {
  "worklet";
  const cx = r.x + r.width / 2;
  const cy = r.y + r.height / 2;
  if (aspect <= 0) return { cx, cy, w: r.width, h: r.height };
  return r.width * aspect > r.height ? { cx, cy, w: r.height / aspect, h: r.height } : { cx, cy, w: r.width, h: r.width * aspect };
}

function inset(r: Rect, pad: number): Rect {
  "worklet";
  return { x: r.x + pad, y: r.y + pad, width: Math.max(1, r.width - 2 * pad), height: Math.max(1, r.height - 2 * pad) };
}

/**
 * The shared element (DESIGN.md section 5, motion 1) as an explicit FLIP on shared values, UI thread only, transform
 * and opacity only. Two layers travel: the ground, which stretches freely from the origin's ground (a tile, or the
 * garment itself on a flat-lay) to the hero's; and the picture, which only ever scales uniformly from where it was
 * drawn to where it will be drawn, so a garment is never squashed on the way. A ground of another tone cross-fades
 * into the hero's as it grows. 420ms ease-out; reduced motion or no origin (a deep link): the hero fades with the page.
 *
 * Not `sharedTransitionTag`: that API sits behind a static flag (needs a native rebuild) and does not exist on web.
 * @param geometry - the hero's final place (pure, known before layout).
 * @param heroTone - the hero ground's tone, to know whether the origin's tone needs a cross-fade.
 */
export function useItemFlight(id: string | undefined, geometry: HeroGeometry, heroTone: TileTone, goBack: () => void) {
  const reduceMotion = useReducedMotion();
  // Read once per mount: the origin belongs to the navigation that created this screen.
  const [origin] = useState<FlightOrigin | null>(() => (id ? getFlightOrigin(id) : null));
  const [returnTo] = useState(() => (id ? captureReturn(id) : null));
  const flies = origin !== null && !reduceMotion;

  const from = useSharedValue<FlightOrigin | null>(origin);
  const progress = useSharedValue(flies ? 0 : 1);
  const fade = useSharedValue(0);
  const contentFade = useSharedValue(0);
  // A flying hero starts fully visible over its origin; otherwise it follows the page fade.
  const heroFollowsFade = useSharedValue(!flies);
  // Height / width of the picture; 0 until known. A flat-lay origin knows it from the drawn rect.
  const aspect = useSharedValue(origin?.image ? origin.image.height / origin.image.width : 0);
  const scrollY = useSharedValue(0);

  useEffect(() => {
    fade.set(withTiming(1, timing(motion.stateMs)));
    contentFade.set(withDelay(CONTENT_DELAY_MS, withTiming(1, timing(motion.stateMs))));
    if (flies) progress.set(withTiming(1, timing(motion.screenMs)));
  }, [fade, contentFade, progress, flies]);

  const closing = useRef(false);
  const close = useCallback(async () => {
    if (closing.current) return;
    closing.current = true;
    const target = returnTo && !reduceMotion ? await returnTo() : null;
    contentFade.set(withTiming(0, timing(CONTENT_EXIT_MS)));
    // Flying back, the page starts to clear halfway: cleared at once, the origin garment showed through beside the
    // still-travelling copy for most of the flight (two trousers on Today's table); cleared only on landing, the
    // picture flew into an empty page (looked at both, 2026-11-18).
    fade.set(target ? withDelay(RETURN_FADE_DELAY_MS, withTiming(0, timing(motion.stateMs))) : withTiming(0, timing(motion.stateMs)));
    if (target) {
      from.set(target);
      heroFollowsFade.set(false);
      progress.set(
        withTiming(0, timing(motion.screenMs), (finished) => {
          "worklet";
          if (finished) scheduleOnRN(goBack);
        })
      );
    } else {
      // No origin to land on (unmounted, scrolled away, a deep link) or reduced motion: opacity only.
      heroFollowsFade.set(true);
      setTimeout(goBack, motion.stateMs);
    }
  }, [returnTo, reduceMotion, contentFade, fade, from, heroFollowsFade, progress, goBack]);

  const ground = geometry.ground;
  const pad = geometry.pad;
  // Only the phone hero scrolls with the page; the desktop one is held in its column.
  const scrolls = !geometry.desktop;

  // don't touch / both layers are laid out once at their FINAL rect and animated with transform + opacity only.
  // Animating left/top/width/height looked right in the worklet but never reached the DOM on web (only opacity did),
  // and it would force a layout pass per frame on native. Scaling about the centre means the offset to the origin is
  // the difference of centres and the scale is the ratio of sizes. The scroll offset is subtracted because the
  // phone hero lives inside the scroll view: on the way back the page may have been scrolled.
  const groundStyle = useAnimatedStyle(() => {
    const o = from.get();
    const k = progress.get();
    const sy = scrolls ? scrollY.get() : 0;
    if (!o) return { opacity: fade.get() };
    const r = o.rect;
    const dx = r.x + r.width / 2 - (ground.x + ground.width / 2);
    const dy = r.y + r.height / 2 - (ground.y - sy + ground.height / 2);
    const sx = r.width / ground.width;
    const syk = r.height / ground.height;
    const base = heroFollowsFade.get() ? fade.get() : 1;
    return {
      opacity: base * (o.loose ? k : 1),
      transform: [{ translateX: dx * (1 - k) }, { translateY: dy * (1 - k) }, { scaleX: sx + (1 - sx) * k }, { scaleY: syk + (1 - syk) * k }],
    };
  });

  /** The origin's own ground colour on top of the hero's, fading out as it grows (only when the tones differ). */
  const originToneStyle = useAnimatedStyle(() => {
    const o = from.get();
    return { opacity: o && o.tone && o.tone !== heroTone && !o.loose ? 1 - progress.get() : 0 };
  });

  const imageStyle = useAnimatedStyle(() => {
    const o = from.get();
    const k = progress.get();
    const sy = scrolls ? scrollY.get() : 0;
    if (!o) return { opacity: fade.get() };
    const a = aspect.get();
    const finalBox = inset(ground, pad);
    const end = fit(finalBox, a);
    const start = o.image ? fit(o.image, 0) : fit(inset(o.rect, o.pad ?? DEFAULT_ORIGIN_PAD), a);
    // Unknown aspect: both are the whole box, so pick the scale that keeps the picture inside the origin.
    const s = a > 0 || o.image ? start.w / end.w : Math.min(start.w / end.w, start.h / end.h);
    const dx = start.cx - end.cx;
    const dy = start.cy - (end.cy - sy);
    return {
      opacity: heroFollowsFade.get() ? fade.get() : 1,
      transform: [{ translateX: dx * (1 - k) }, { translateY: dy * (1 - k) }, { scale: s + (1 - s) * k }],
    };
  });

  const fadeStyle = useAnimatedStyle(() => ({ opacity: fade.get() }));
  const contentStyle = useAnimatedStyle(() => ({
    opacity: contentFade.get(),
    // Reduced motion: opacity only (DESIGN.md section 5).
    transform: [{ translateY: reduceMotion ? 0 : (1 - contentFade.get()) * 8 }],
  }));

  const onScroll = useAnimatedScrollHandler((e) => {
    scrollY.set(e.contentOffset.y);
  });

  /** The picture's shape, once it has loaded (or 1 for a drawing): until then the flight scales by the box. */
  const onAspect = useCallback((a: number) => aspect.set(a), [aspect]);

  return { close, groundStyle, originToneStyle, imageStyle, fadeStyle, contentStyle, onScroll, onAspect, origin };
}
