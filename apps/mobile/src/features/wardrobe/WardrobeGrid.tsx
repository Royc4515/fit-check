import type { Item } from "@fit-check/schema";
import { useTranslation } from "react-i18next";
import { Text, View } from "react-native";
import Animated, { Easing, FadeIn, FadeOut, LinearTransition } from "react-native-reanimated";
import { motion } from "../../theme/tokens";
import { groupByCategory } from "./filters";

// DESIGN.md section 4, animation 2: items glide to their new place in 280ms ease-out when the list changes.
// Built once at module level: the builder is stateless and recreating it per render allocates for nothing.
const layoutTransition = LinearTransition.duration(motion.layoutMs).easing(Easing.bezier(...motion.easeOut).factory());
const entering = FadeIn.duration(motion.stateMs);
const exiting = FadeOut.duration(motion.stateMs);

const HALF_GAP = 6;

function Cell({ item, columns }: { item: Item; columns: number }) {
  return (
    // don't touch / inline style, not className: NativeWind ignores className on Reanimated's Animated.View.
    <Animated.View
      layout={layoutTransition}
      entering={entering}
      exiting={exiting}
      style={{ width: `${100 / columns}%`, paddingHorizontal: HALF_GAP, paddingBottom: 12 }}
    >
      {/* Same box a cutout will occupy, on ivory-deep; 2px radius because grid images are small. */}
      <View className="rounded-sm bg-ivory-deep" style={{ width: "100%", aspectRatio: 3 / 4 }} />
      <Text className="mt-2 font-body text-body-sm text-ink" numberOfLines={2}>
        {item.name}
      </Text>
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
          <View className="mb-3 flex-row items-baseline" style={{ gap: 8 }}>
            <Text className="font-body-semibold text-title text-ink">{t(`wardrobe.category.${category}`)}</Text>
            <Text className="font-mono text-body-sm text-ink-faint">{groupItems.length}</Text>
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
