import type { ItemTags } from "@fit-check/schema";
import { Text, View, type ViewStyle } from "react-native";
import { ItemArt } from "../../components/item-art/ItemArt";

type Props = {
  name: string;
  tags?: ItemTags;
  style?: ViewStyle;
};

/**
 * One garment in the Today composition: its drawing (or later its cutout) on --ivory-deep, the name small at the
 * bottom. DESIGN.md: item backgrounds are always ivory-deep so the catalogue looks uniform.
 */
export function ItemPlaceholder({ name, tags, style }: Props) {
  return (
    // don't touch / the 1px hairline is what separates overlapping blocks: they share one fill, so without
    // it the 8px overlap merges into a single blob.
    <View className="justify-end border border-hairline bg-ivory-deep" style={style}>
      {tags ? (
        <View style={{ position: "absolute", top: "8%", bottom: "16%", left: "8%", right: "8%" }}>
          <ItemArt tags={tags} />
        </View>
      ) : null}
      <Text className="p-2 font-body text-meta text-ink-soft" numberOfLines={1}>
        {name}
      </Text>
    </View>
  );
}
