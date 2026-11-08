import type { Item } from "@fit-check/schema";
import { useRouter } from "expo-router";
import { useRef } from "react";
import { useTranslation } from "react-i18next";
import { Text, View } from "react-native";
import { PressScale } from "../../components/PressScale";
import Animated, { Easing, FadeIn, FadeOut, LinearTransition } from "react-native-reanimated";
import { motion } from "../../theme/tokens";
import { ItemArt } from "../../components/item-art/ItemArt";
import { measureNode, registerCell, setOrigin, type ViewNode } from "../item/transition";
import { groupByCategory } from "./filters";

// DESIGN.md section 4, animation 2: items glide to their new place in 280ms ease-out when the list changes.
// Built once at module level: the builder is stateless and recreating it per render allocates for nothing.
const layoutTransition = LinearTransition.duration(motion.layoutMs).easing(Easing.bezier(...motion.easeOut).factory());
const entering = FadeIn.duration(motion.stateMs);
const exiting = FadeOut.duration(motion.stateMs);

const HALF_GAP = 6;

/** Distinct item colours of a group, lightest first, capped so a strip never wraps into a block. */
function swatches(items: Item[]): string[] {
  const lum = (hex: string) => {
    const n = parseInt(hex.slice(1), 16);
    return 0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255);
  };
  return [...new Set(items.map((i) => i.tags.color_hex.toUpperCase()))].sort((a, b) => lum(b) - lum(a)).slice(0, 24);
}

function Cell({ item, columns }: { item: Item; columns: number }) {
  const { t } = useTranslation();
  const router = useRouter();
  const image = useRef<ViewNode | null>(null);

  const open = async () => {
    // Measure first, push second: the item screen needs the rect on its very first frame to start the flight
    // from exactly where the thumbnail is. If measuring fails it just fades in, which is still correct.
    const rect = await measureNode(image.current);
    if (rect) setOrigin(item.id, rect);
    router.push({ pathname: "/item/[id]", params: { id: item.id } });
  };

  return (
    // don't touch / inline style, not className: NativeWind ignores className on Reanimated's Animated.View.
    <Animated.View
      layout={layoutTransition}
      entering={entering}
      exiting={exiting}
      style={{ width: `${100 / columns}%`, paddingHorizontal: HALF_GAP, paddingBottom: 12 }}
    >
      <PressScale onPress={() => void open()} accessibilityRole="button" accessibilityLabel={item.name}>
        {/* Same box a cutout will occupy, on ivory-deep; 2px radius because grid images are small. */}
        <View
          // don't touch / one callback ref feeds both the local ref (origin measuring on press) and the registry
          // (target measuring when the item screen flies back). Attaching only one silently breaks the other.
          ref={(node) => {
            image.current = node;
            registerCell(item.id, node);
          }}
          collapsable={false}
          className="rounded-sm bg-ivory-deep"
          style={{ width: "100%", aspectRatio: 3 / 4, padding: "12%" }}
        >
          <ItemArt tags={item.tags} />
        </View>
        <Text className="mt-2 font-body text-body-sm text-ink" numberOfLines={1}>
          {item.name}
        </Text>
        <Text className="font-body text-meta text-ink-faint" numberOfLines={1}>
          {`${t(`item.subcategory.${item.tags.subcategory}`)} · ${t(`wardrobe.color.${item.tags.color_name}`)}`}
        </Text>
      </PressScale>
    </Animated.View>
  );
}

/**
 * Items grouped by category, three columns on a phone and five on wide web (DESIGN.md section 3). Cells are
 * percentage-wide so the grid is correct on first render without measuring. Not virtualized: fine for ~110
 * placeholders, but once real images land this must become a FlatList-per-section or a flattened FlatList.
 */
export function WardrobeGrid({ items, columns }: { items: Item[]; columns: number }) {
  const { t } = useTranslation();
  const groups = groupByCategory(items);

  if (groups.length === 0) {
    return <Text className="font-body text-body text-ink-soft">{t("wardrobe.noMatch")}</Text>;
  }

  return (
    <View style={{ gap: 32 }}>
      {groups.map(({ category, items: groupItems }) => (
        <View key={category}>
          {/* Section head: name in the display face, count in mono, then the category's real colours as a strip
              of swatches (lightest to darkest): the wardrobe's palette at a glance. */}
          <View className="mb-4 border-b border-hairline pb-3">
            <View className="flex-row items-baseline" style={{ gap: 10 }}>
              <Text className="font-display text-display text-ink">{t(`wardrobe.category.${category}`)}</Text>
              <Text className="font-mono text-body-sm text-ink-faint">{groupItems.length}</Text>
            </View>
            <View className="mt-2 flex-row flex-wrap" style={{ gap: 3 }}>
              {swatches(groupItems).map((hex) => (
                <View key={hex} className="border border-hairline" style={{ width: 10, height: 10, backgroundColor: hex }} />
              ))}
            </View>
          </View>
          {/* Negative margin cancels the cells' outer padding so the grid edge meets the screen gutter. */}
          <View style={{ flexDirection: "row", flexWrap: "wrap", marginHorizontal: -HALF_GAP }}>
            {groupItems.map((item) => (
              <Cell key={item.id} item={item} columns={columns} />
            ))}
          </View>
        </View>
      ))}
    </View>
  );
}
