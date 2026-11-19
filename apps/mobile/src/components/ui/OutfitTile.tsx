import { Pressable, Text, View } from "react-native";
import Animated from "react-native-reanimated";
import { Button } from "./Button";
import { FlatLay, type FlatLayPiece } from "./FlatLay";
import { focusRingProps, usePressFeedback } from "./interaction";
import { Skeleton } from "./Skeleton";
import { Meta } from "./Type";

/** Space under the flat-lay: 8 gap + body-sm line (22) + meta line (18), the same as a wardrobe tile's caption. */
export const OUTFIT_TILE_CAPTION_HEIGHT = 8 + 22 + 18;

type Props = {
  /** The garments, placed by slot; numbers are not drawn on a tile. A deleted garment is simply not in the list. */
  pieces: readonly FlatLayPiece[];
  /** The outfit's name, or its garment types joined with " · ". One line. */
  title: string;
  /** "נלבש 3 פעמים · 12.11" / "עוד לא נלבש", meta ink-faint, one line. */
  meta: string;
  favorite: boolean;
  /** Opens the outfit. */
  onPress: () => void;
  onToggleFavorite: () => void;
  /** The tile button's spoken name: what the outfit is and what it holds. */
  accessibilityLabel: string;
  /** The heart's spoken name: what pressing it will do ("הוסף למועדפים" / "הסר מהמועדפים"). */
  favoriteLabel: string;
};

/**
 * Outfit tile (DESIGN.md section 4, "שלב 5.2" item 3): a small 4:5 `FlatLay` on the tile tone, radius 6, no numbers;
 * under it the name (or the garment types) in body-sm and a meta line. The whole tile is one button that opens the
 * outfit; the favourite heart at its top-end corner is a separate 44 button beside it in the tree (never a button
 * inside a button), filled = favourite, outline = not, with its state announced, so the meaning never rests on
 * colour. Press = the library's scale 0.97, no shadow at rest.
 */
export function OutfitTile({ pieces, title, meta, favorite, onPress, onToggleFavorite, accessibilityLabel, favoriteLabel }: Props) {
  const { onPressIn, onPressOut, pressStyle } = usePressFeedback();
  return (
    <View>
      <Pressable {...focusRingProps} onPress={onPress} onPressIn={onPressIn} onPressOut={onPressOut} accessibilityRole="button" accessibilityLabel={accessibilityLabel}>
        <Animated.View style={pressStyle}>
          {/* A picture here: the button already says what it shows, and the garments are far under 44. */}
          <View importantForAccessibility="no-hide-descendants" accessibilityElementsHidden aria-hidden>
            <FlatLay pieces={pieces} numbered={false} radius="md" pieceFocusable={false} accessibilityLabel={accessibilityLabel} />
          </View>
          {/* don't touch / start-aligned box, not text alignment: react-native-web gives text dir="auto", so a Latin
              name inside an RTL grid would hug the far edge (same as Tile's caption). */}
          <View className="mt-2" style={{ height: OUTFIT_TILE_CAPTION_HEIGHT - 8, alignItems: "flex-start" }}>
            <Text className="font-body text-body-sm text-ink" numberOfLines={1} style={{ maxWidth: "100%" }}>
              {title}
            </Text>
            <Meta numberOfLines={1} style={{ maxWidth: "100%" }}>
              {meta}
            </Meta>
          </View>
        </Animated.View>
      </Pressable>
      {/* After the tile in the tree: one Tab stop for the outfit, the next for its heart. */}
      <View style={{ position: "absolute", top: 0, end: 0 }}>
        <Button
          variant="icon"
          icon={favorite ? "favorite_fill" : "favorite"}
          iconSize={20}
          selected={favorite}
          accessibilityLabel={favoriteLabel}
          onPress={onToggleFavorite}
        />
      </View>
    </View>
  );
}

/** A tile's final size while the collection loads: the 4:5 ground and the two caption lines, pulsing quietly. */
export function OutfitTileSkeleton() {
  return (
    <View>
      <Skeleton aspect={1.25} />
      <View className="mt-2" style={{ height: OUTFIT_TILE_CAPTION_HEIGHT - 8, gap: 4 }}>
        <Skeleton height={14} width="70%" radius="sm" />
        <Skeleton height={12} width="45%" radius="sm" />
      </View>
    </View>
  );
}
