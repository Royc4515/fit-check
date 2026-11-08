import type { ItemTags } from "@fit-check/schema";
import { View } from "react-native";
import { ItemArt } from "../item-art/ItemArt";

/** A fixed, generic outfit for the cover: not the user's wardrobe (the sign-in screen has none to show yet). */
const PIECES: Array<{ tags: Pick<ItemTags, "subcategory" | "color_hex" | "secondary_color_hex" | "pattern">; style: object }> = [
  { tags: { subcategory: "button_down", color_hex: "#F4F1EA", secondary_color_hex: "#4A6FA5", pattern: "stripes" }, style: { width: "52%", aspectRatio: 3 / 4 } },
  { tags: { subcategory: "chinos", color_hex: "#1F2A44", secondary_color_hex: null, pattern: "solid" }, style: { width: "100%", aspectRatio: 1 / 1.4 } },
  { tags: { subcategory: "dress_shoes", color_hex: "#6B4A2B", secondary_color_hex: null, pattern: "solid" }, style: { width: "88%", aspectRatio: 1 / 0.62, marginTop: -8, alignSelf: "flex-end" } },
];

/**
 * Three garments overlapping by 8px on ivory-deep, the same composition language as Today, so the first screen
 * already shows what the app does.
 */
export function StillLife() {
  const [shirt, chinos, shoes] = PIECES as [(typeof PIECES)[0], (typeof PIECES)[0], (typeof PIECES)[0]];
  const tile = (p: (typeof PIECES)[0], pad = "9%") => (
    <View className="border border-hairline bg-ivory-deep" style={[p.style, { padding: pad as `${number}%` }]}>
      <ItemArt tags={p.tags as ItemTags} />
    </View>
  );
  return (
    <View style={{ flexDirection: "row", alignItems: "flex-start" }}>
      <View style={{ width: "56%", paddingTop: 24 }}>{tile({ ...shirt, style: { ...shirt.style, width: "100%" } })}</View>
      <View style={{ flex: 1, marginStart: -8 }}>
        {tile(chinos)}
        {/* Shoes sit in a wide, short frame and are height-limited; less padding lets them read at a glance. */}
        {tile(shoes, "3%")}
      </View>
    </View>
  );
}
