import { Image } from "expo-image";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { View, type DimensionValue } from "react-native";
import type { TileTone } from "../../theme/tileTone";
import { colors, motion } from "../../theme/tokens";
import { Icon } from "./Icon";
import { Skeleton } from "./Skeleton";
import { Meta } from "./Type";
import { FRAME, type TileSize } from "./Tile";

type Props = {
  /** The photo. Missing = still loading: the reserved box pulses in the tile tone. */
  uri?: string | null;
  /** A second address for the same picture, tried once if `uri` cannot be read (a garment missing from R2). */
  fallbackUri?: string | null;
  tone?: TileTone;
  size?: TileSize;
  /** Box width: a number in px or a percentage. Defaults to the parent's width. */
  width?: DimensionValue;
  /** Height / width of the box, fixed up front so nothing jumps when the image arrives. */
  aspect: number;
  /** A photo of a whole scene (the picked photo) fills the box; a garment crop is `contain`ed like a tile. */
  fit?: "contain" | "cover";
  /** Force the reserved loading state even with a uri. */
  loading?: boolean;
  /** The image could not be read (an expired signed address, say): the owner decides what to do, the tile shows the glyph. */
  onError?: () => void;
  /**
   * With no `uri`: a still box in the tile tone that says why there is no picture, instead of the loading pulse.
   * Keeps a place at its final size for something that has not been made yet (the try-on sheet before "generate").
   */
  emptyLabel?: string;
  accessibilityLabel: string;
};

/**
 * A tile for a photo that is not a wardrobe item yet (a picked photo, a crop under review, the existing garment in a
 * duplicate check): the same ground, radius and padding as `Tile`, the same reserved size and quiet pulse while the
 * image loads, no frame. Not pressable; `Tile` stays the one component for items. If the image cannot be read it
 * shows an error glyph on the ground, never an endless pulse.
 */
export function PhotoTile({ uri: primaryUri, fallbackUri, tone = "tile", size = "grid", width = "100%", aspect, fit = "contain", loading = false, onError, emptyLabel, accessibilityLabel }: Props) {
  const { t } = useTranslation();
  const frame = FRAME[size];
  // Keyed by the primary address, like the two below, so a new photo in the box starts from its own primary.
  const [fellBackFrom, setFellBackFrom] = useState<string | null>(null);
  const uri = fallbackUri && fellBackFrom === primaryUri ? fallbackUri : primaryUri;
  // Keyed by uri, so a new photo in the same box starts from loading again without an effect to reset it.
  const [loadedUri, setLoadedUri] = useState<string | null>(null);
  const [failedUri, setFailedUri] = useState<string | null>(null);
  const loaded = loadedUri === uri;
  const failed = failedUri === uri;
  const reserved = loading || !uri;
  const pad = fit === "cover" ? 0 : frame.pad;
  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel={accessibilityLabel}
      style={{ width, aspectRatio: 1 / aspect, borderRadius: frame.radius, backgroundColor: colors[tone], overflow: "hidden" }}
    >
      {reserved && emptyLabel && !uri && !loading ? (
        <View className="flex-1 items-center justify-center" style={{ padding: frame.pad }}>
          <Meta className="text-center">{emptyLabel}</Meta>
        </View>
      ) : reserved ? (
        <Skeleton height="100%" tone={tone} radius="none" />
      ) : failed ? (
        <View className="flex-1 items-center justify-center" accessibilityLabel={t("ui.imageFailed")}>
          <Icon name="error" color="warn" />
        </View>
      ) : (
        <>
          <View style={{ flex: 1, padding: pad }}>
            <Image
              source={{ uri }}
              contentFit={fit}
              cachePolicy="memory-disk"
              recyclingKey={uri ?? ""}
              transition={{ duration: motion.stateMs, effect: "cross-dissolve" }}
              onLoad={() => setLoadedUri(uri ?? null)}
              onError={() => {
                if (fallbackUri && primaryUri && uri === primaryUri) {
                  setFellBackFrom(primaryUri);
                  return;
                }
                setFailedUri(uri ?? null);
                onError?.();
              }}
              style={{ width: "100%", height: "100%" }}
              accessibilityIgnoresInvertColors
            />
          </View>
          {/* Until the first paint, the reserved box pulses; the image fades in over it. */}
          {loaded ? null : (
            <View pointerEvents="none" style={{ position: "absolute", top: 0, bottom: 0, start: 0, end: 0 }}>
              <Skeleton height="100%" tone={tone} radius="none" />
            </View>
          )}
        </>
      )}
    </View>
  );
}
