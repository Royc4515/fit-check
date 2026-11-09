import type { ItemTags } from "@fit-check/schema";
import { Text, View, type ViewStyle } from "react-native";
import { ItemArt } from "../../components/item-art/ItemArt";

type Props = {
  /** Two-digit index ("01") that ties the piece to its caption below the composition. */
  index: string;
  tags?: ItemTags;
  /** The item's photo, when it has one; otherwise its drawing. */
  cutoutPath?: string | null;
  style?: ViewStyle;
};

/**
 * One garment in the Today composition: its drawing (later its cutout) on --ivory-deep, with a mono index in the
 * corner instead of a name squeezed inside the frame; names live in the numbered captions, magazine-style.
 */
export function ItemPlaceholder({ index, tags, cutoutPath, style }: Props) {
  return (
    // don't touch / the 1px hairline is what separates overlapping blocks: they share one fill, so without
    // it the 8px overlap merges into a single blob.
    <View className="border border-hairline bg-ivory-deep" style={style}>
      {tags ? (
        <View style={{ position: "absolute", top: "10%", bottom: "8%", left: "10%", right: "10%" }}>
          <ItemArt tags={tags} cutoutPath={cutoutPath} />
        </View>
      ) : null}
      <Text className="p-2 font-mono text-meta text-ink-faint">{index}</Text>
    </View>
  );
}
