import type { PairWeights } from "@fit-check/engine";
import type { Availability, Item } from "@fit-check/schema";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import { BackHandler, Platform, Pressable, Text, View, useWindowDimensions } from "react-native";
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { scheduleOnRN } from "react-native-worklets";
import { ItemArt } from "../../components/item-art/ItemArt";
import { ItemDetails } from "../../features/item/ItemDetails";
import { clearOrigin, getOrigin, measureCell, type Rect } from "../../features/item/transition";
import { WardrobeGate } from "../../components/WardrobeGate";
import { useWardrobe } from "../../data/WardrobeProvider";
import { setAvailability } from "../../data/feedback";
import { colors, layout, motion } from "../../theme/tokens";

const HERO_SCREEN_FRACTION = 0.6;
const ease = Easing.bezier(...motion.easeOut);

/**
 * Item screen with the one shared-element transition (DESIGN.md section 4, animation 1): the picture travels
 * from its grid cell to the hero slot over 420ms ease-out while everything else fades.
 *
 * Implemented as an explicit FLIP on Reanimated shared values rather than `sharedTransitionTag`: that API sits
 * behind the ENABLE_SHARED_ELEMENT_TRANSITIONS static flag (needs a native rebuild) and does not exist on web.
 * This runs on the UI thread on every platform with one code path. The route is a transparent modal with no
 * native animation, so the wardrobe stays visible underneath until the background fades in.
 */
export default function ItemScreen() {
  const wardrobe = useWardrobe();
  const { id } = useLocalSearchParams<{ id: string }>();
  if (wardrobe.status !== "ready") return <WardrobeGate state={wardrobe} />;
  const { patch } = wardrobe;
  /** Optimistic: the control moves at once; a failed write moves it back and rethrows so the screen can say so. */
  const changeAvailability = async (itemId: string, next: Availability, prev: Availability) => {
    const set = (a: Availability) => patch((d) => ({ ...d, items: d.items.map((i) => (i.id === itemId ? { ...i, availability: a } : i)) }));
    set(next);
    try {
      // Back home from the laundry or from base means it was washed: its wear count starts over.
      await setAvailability(itemId, next, { washed: next === "home" && (prev === "laundry" || prev === "away") });
    } catch (error) {
      set(prev);
      throw error;
    }
  };
  return <ItemContent id={id} items={wardrobe.items} pairWeights={wardrobe.pairWeights} onAvailability={changeAvailability} />;
}

export function ItemContent({
  id,
  items,
  pairWeights,
  onAvailability,
}: {
  id: string | undefined;
  items: Item[];
  pairWeights: PairWeights;
  onAvailability?: (itemId: string, next: Availability, prev: Availability) => Promise<void>;
}) {
  const { t } = useTranslation();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const reduceMotion = useReducedMotion();
  const { width: windowW, height: windowH } = useWindowDimensions();

  const item = useMemo(() => items.find((i) => i.id === id), [items, id]);

  const contentW = Math.min(windowW, layout.maxContentWidth);
  const heroH = Math.round(windowH * HERO_SCREEN_FRACTION);
  const final: Rect = { x: (windowW - contentW) / 2, y: 0, width: contentW, height: heroH };

  // Deep links have no recorded origin and just fade in.
  const origin = useMemo(() => (id ? getOrigin(id) : null), [id]);
  const flies = origin !== null && !reduceMotion;

  const from = useSharedValue<Rect>(origin ?? final);
  const progress = useSharedValue(flies ? 0 : 1);
  const fade = useSharedValue(0);
  // Text follows the page by 100ms so it never sits on top of the still-visible grid.
  const contentFade = useSharedValue(0);
  // Hero opacity follows `fade` only when there is no flight; a flying hero starts fully visible over its cell.
  const heroFollowsFade = useSharedValue(!flies);

  useEffect(() => {
    fade.value = withTiming(1, { duration: motion.stateMs, easing: ease });
    contentFade.value = withDelay(100, withTiming(1, { duration: motion.stateMs, easing: ease }));
    if (flies) progress.value = withTiming(1, { duration: motion.screenMs, easing: ease });
  }, [fade, contentFade, progress, flies]);

  const goBack = useCallback(() => router.back(), [router]);
  const closing = useRef(false);

  const close = useCallback(async () => {
    if (closing.current) return;
    closing.current = true;
    clearOrigin();
    const target = item ? await measureCell(item.id) : null;
    contentFade.value = withTiming(0, { duration: 120, easing: ease });
    fade.value = withTiming(0, { duration: motion.stateMs, easing: ease });
    if (target && !reduceMotion) {
      from.value = target;
      progress.value = withTiming(0, { duration: motion.screenMs, easing: ease }, (finished) => {
        if (finished) scheduleOnRN(goBack);
      });
    } else {
      // No cell to fly back to (filtered out meanwhile) or reduced motion: opacity only.
      heroFollowsFade.value = true;
      setTimeout(goBack, motion.stateMs);
    }
  }, [item, reduceMotion, from, progress, fade, contentFade, heroFollowsFade, goBack]);

  useEffect(() => {
    // Hardware back is an Android thing; react-native-web's BackHandler is a stub that logs an error.
    if (Platform.OS !== "android") return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      void close();
      return true;
    });
    return () => sub.remove();
  }, [close]);

  // don't touch / the hero is laid out once at its FINAL rect and animated with transform + opacity only.
  // Animating left/top/width/height looked right in the worklet but never reached the DOM on web (only
  // opacity did), and it would force a layout pass per frame on native. Scaling about the centre means the
  // offset to the origin is the difference of centres and the scale is the ratio of sizes.
  const heroStyle = useAnimatedStyle(() => {
    const f = from.value;
    const k = progress.value;
    const dx = f.x + f.width / 2 - (final.x + final.width / 2);
    const dy = f.y + f.height / 2 - (final.y + final.height / 2);
    const sx = f.width / final.width;
    const sy = f.height / final.height;
    return {
      opacity: heroFollowsFade.value ? fade.value : 1,
      transform: [
        { translateX: dx * (1 - k) },
        { translateY: dy * (1 - k) },
        { scaleX: sx + (1 - sx) * k },
        { scaleY: sy + (1 - sy) * k },
      ],
    };
  });
  const fadeStyle = useAnimatedStyle(() => ({ opacity: fade.value }));
  const contentStyle = useAnimatedStyle(() => ({
    opacity: contentFade.value,
    // Reduced motion: opacity only (DESIGN.md section 4).
    transform: [{ translateY: reduceMotion ? 0 : (1 - contentFade.value) * 8 }],
  }));

  return (
    <View style={{ flex: 1 }}>
      {/* The ivory page fades in over the wardrobe: "the rest fades" while the picture travels. */}
      <Animated.View
        pointerEvents="none"
        style={[{ position: "absolute", top: 0, bottom: 0, start: 0, end: 0, backgroundColor: colors["ivory"] }, fadeStyle]}
      />
      <Animated.ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 64 }}>
        <Animated.View
          testID="item-hero"
          style={[
            {
              position: "absolute",
              left: final.x,
              top: final.y,
              width: final.width,
              height: final.height,
              backgroundColor: colors["ivory-deep"],
            },
            heroStyle,
          ]}
        >
          {/* Inside the flying frame, so the drawing travels and scales with it. */}
          {item ? (
            <View style={{ flex: 1, padding: "14%" }}>
              <ItemArt tags={item.tags} />
            </View>
          ) : null}
        </Animated.View>
        <View style={{ width: "100%", maxWidth: layout.maxContentWidth, alignSelf: "center" }}>
          <View style={{ height: heroH }} />
          <Animated.View style={[{ paddingHorizontal: layout.gutter, paddingTop: 32 }, contentStyle]}>
            {item ? (
              <ItemDetails item={item} items={items} pairWeights={pairWeights} onAvailability={onAvailability} />
            ) : (
              <Text className="font-body text-body text-ink-soft">{t("item.notFound")}</Text>
            )}
          </Animated.View>
        </View>
      </Animated.ScrollView>
      {/* Full-width layer, content-width inner column: on wide web the link lines up with the hero, not the window. */}
      <Animated.View
        pointerEvents="box-none"
        style={[{ position: "absolute", top: insets.top + 16, start: 0, end: 0, zIndex: 2 }, fadeStyle]}
      >
        <View
          pointerEvents="box-none"
          style={{
            width: "100%",
            maxWidth: layout.maxContentWidth,
            alignSelf: "center",
            paddingHorizontal: layout.gutter,
            alignItems: "flex-start",
          }}
        >
          <Pressable onPress={() => void close()} accessibilityRole="button" hitSlop={12}>
            <View className="border-b border-hairline pb-1">
              <Text className="font-body text-body-sm text-ink">{t("item.back")}</Text>
            </View>
          </Pressable>
        </View>
      </Animated.View>
    </View>
  );
}
