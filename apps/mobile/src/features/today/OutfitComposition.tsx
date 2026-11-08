import type { CandidateOutfit, ItemTags } from "@fit-check/schema";
import { View } from "react-native";
import { layout } from "../../theme/tokens";
import { ItemPlaceholder } from "./ItemPlaceholder";

type Props = {
  items: CandidateOutfit["items"];
  /** Candidates carry only what the stylist needs; the drawing needs the full tags, looked up by id. */
  tagsById: ReadonlyMap<string, ItemTags>;
};

const STAGGER = 32;

/**
 * Asymmetric composition (DESIGN.md section 3): the top is large on the start side; bottom and shoes
 * are staggered on the end side and overlap each other by 8px.
 *
 * Sizes are percentages plus `aspectRatio`, never pixels from the window width. don't touch / the static
 * web export renders with width 0 and React does not repair inline styles on hydration, so pixel math
 * from useWindowDimensions produced a blank page. Direction comes from the flex row itself, so the
 * composition mirrors in LTR without a conditional.
 */
/** Reading order of an outfit: top, bottom, shoes, layer. The composition and the captions share it. */
export const SLOT_ORDER = ["top", "bottom", "shoes", "layer"] as const;

/** "01".."04" for an item by reading order, so the tile corner and its caption always agree. */
export function outfitIndex(items: CandidateOutfit["items"], id: string): string {
  const ordered = SLOT_ORDER.flatMap((slot) => items.filter((i) => i.slot === slot));
  return String(ordered.findIndex((i) => i.id === id) + 1).padStart(2, "0");
}

export function OutfitComposition({ items, tagsById }: Props) {
  const top = items.find((i) => i.slot === "top");
  const bottom = items.find((i) => i.slot === "bottom");
  const shoes = items.find((i) => i.slot === "shoes");
  const layer = items.find((i) => i.slot === "layer");
  const o = layout.overlap;
  const indexOf = (piece: CandidateOutfit["items"][number]) => outfitIndex(items, piece.id);

  return (
    <View style={{ flexDirection: "row", alignItems: "flex-start" }}>
      <View style={{ width: "58%" }}>
        {top ? <ItemPlaceholder index={indexOf(top)} tags={tagsById.get(top.id)} style={{ width: "100%", aspectRatio: 3 / 4 }} /> : null}
        {layer ? (
          <ItemPlaceholder index={indexOf(layer)} tags={tagsById.get(layer.id)} style={{ width: "70%", aspectRatio: 1 / 0.85, marginTop: -o }} />
        ) : null}
      </View>
      {/* Negative marginStart pulls the end column 8px under the top so three boxes read as one outfit. */}
      <View style={{ flex: 1, marginStart: -o, paddingTop: STAGGER }}>
        {bottom ? <ItemPlaceholder index={indexOf(bottom)} tags={tagsById.get(bottom.id)} style={{ width: "100%", aspectRatio: 1 / 1.45 }} /> : null}
        {shoes ? (
          <ItemPlaceholder
            index={indexOf(shoes)}
            tags={tagsById.get(shoes.id)}
            style={{ width: "86%", aspectRatio: 1 / 0.7, marginTop: -o, alignSelf: "flex-end" }}
          />
        ) : null}
      </View>
    </View>
  );
}
