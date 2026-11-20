import { useState } from "react";
import { View, type LayoutChangeEvent } from "react-native";
import { FLAT_LAY_ASPECT } from "./FlatLay";
import { Skeleton } from "./Skeleton";
import { Meta } from "./Type";

/**
 * The flat-lay's place while its outfit is on its way (DESIGN.md section 1: loading is the place kept at its final
 * size, in the tile tone, with a quiet opacity pulse; no spinner). Sized exactly as FlatLay is: full width at 4:5, or
 * capped at `maxHeight` once measured, so the garments arrive in the same box. `label` says in words what the screen
 * waits for; it sits on the surface, still (only the surface pulses), and is announced politely.
 *
 * @param maxHeight - the same cap Today passes to FlatLay (undefined: plain 4:5).
 * @param radius - "md" for the desktop column and the 600-899 card, as FlatLay.
 */
export function FlatLayPlaceholder({ maxHeight, radius = "none", label }: { maxHeight?: number; radius?: "none" | "md"; label: string }) {
  const [width, setWidth] = useState<number | null>(null);
  const onLayout = (e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width);
  const height = maxHeight !== undefined && width !== null ? Math.min(width * FLAT_LAY_ASPECT, maxHeight) : null;
  return (
    <View onLayout={onLayout} style={{ width: "100%", ...(height !== null ? { height } : { aspectRatio: 1 / FLAT_LAY_ASPECT }) }}>
      <View style={{ position: "absolute", top: 0, bottom: 0, start: 0, end: 0 }}>
        <Skeleton height="100%" tone="tile" radius={radius} />
      </View>
      <View className="flex-1 items-center justify-end px-5" style={{ paddingBottom: 24 }} pointerEvents="none">
        {/* Sentence-like text, so no English uppercase from the Meta default. */}
        <Meta tone="text-ink-soft" accessibilityLiveRegion="polite" style={{ textTransform: "none", textAlign: "center" }}>
          {label}
        </Meta>
      </View>
    </View>
  );
}
