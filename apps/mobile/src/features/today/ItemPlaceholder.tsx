import { Text, View, type ViewStyle } from "react-native";

type Props = {
  name: string;
  style?: ViewStyle;
};

/**
 * Stand-in for a cutout until item images exist. Same box a cutout would occupy, on --ivory-deep
 * (DESIGN.md: item backgrounds are always ivory-deep so the catalogue looks uniform).
 */
export function ItemPlaceholder({ name, style }: Props) {
  return (
    // don't touch / the 1px hairline is what separates overlapping blocks: they share one fill, so without
    // it the 8px overlap merges into a single blob.
    <View className="justify-end border border-hairline bg-ivory-deep p-2" style={style}>
      <Text className="font-body text-meta text-ink-soft" numberOfLines={2}>
        {name}
      </Text>
    </View>
  );
}
