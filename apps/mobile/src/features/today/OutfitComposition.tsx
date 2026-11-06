import type { CandidateOutfit } from "@fit-check/schema";
import { View } from "react-native";
import { layout } from "../../theme/tokens";
import { ItemPlaceholder } from "./ItemPlaceholder";

type Props = {
  items: CandidateOutfit["items"];
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
export function OutfitComposition({ items }: Props) {
  const top = items.find((i) => i.slot === "top");
  const bottom = items.find((i) => i.slot === "bottom");
  const shoes = items.find((i) => i.slot === "shoes");
  const layer = items.find((i) => i.slot === "layer");
  const o = layout.overlap;

  return (
    <View style={{ flexDirection: "row", alignItems: "flex-start" }}>
      <View style={{ width: "58%" }}>
        {top ? <ItemPlaceholder name={top.name} style={{ width: "100%", aspectRatio: 3 / 4 }} /> : null}
        {layer ? (
          <ItemPlaceholder name={layer.name} style={{ width: "70%", aspectRatio: 1 / 0.85, marginTop: -o }} />
        ) : null}
      </View>
      {/* Negative marginStart pulls the end column 8px under the top so three boxes read as one outfit. */}
      <View style={{ flex: 1, marginStart: -o, paddingTop: STAGGER }}>
        {bottom ? <ItemPlaceholder name={bottom.name} style={{ width: "100%", aspectRatio: 1 / 1.45 }} /> : null}
        {shoes ? (
          <ItemPlaceholder
            name={shoes.name}
            style={{ width: "86%", aspectRatio: 1 / 0.7, marginTop: -o, alignSelf: "flex-end" }}
          />
        ) : null}
      </View>
    </View>
  );
}
