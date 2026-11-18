import type { ItemTags } from "@fit-check/schema";
import { View } from "react-native";
import { ItemArt } from "../item-art/ItemArt";
import { colors, type ColorToken } from "../../theme/tokens";

/**
 * A fixed, generic outfit for the cover: not the user's wardrobe (the sign-in screen has none to show yet).
 * Hex values live here and only here: they are illustration data (the drawn garments' fabric colours, the same kind
 * of value a user's item tags carry), not UI colour, so they are not design tokens.
 */
const PIECES: { tags: Pick<ItemTags, "subcategory" | "color_hex" | "secondary_color_hex" | "pattern">; style: object; ground: ColorToken }[] = [
  { tags: { subcategory: "button_down", color_hex: "#F4F1EA", secondary_color_hex: "#4A6FA5", pattern: "stripes" }, ground: "tile-deep", style: { width: "52%", aspectRatio: 3 / 4 } },
  { tags: { subcategory: "chinos", color_hex: "#1F2A44", secondary_color_hex: null, pattern: "solid" }, ground: "tile", style: { width: "100%", aspectRatio: 1 / 1.4 } },
  { tags: { subcategory: "dress_shoes", color_hex: "#6B4A2B", secondary_color_hex: null, pattern: "solid" }, ground: "tile-cool", style: { width: "88%", aspectRatio: 1 / 0.62, marginTop: -8, alignSelf: "flex-end" } },
];

/**
 * Three garments overlapping by 8px, the same composition language as Today, so the first screen already shows what
 * the app does. Each sits on its own neutral tile ground, so the overlaps read without a frame (DESIGN.md section 1).
 */
export function StillLife() {
  const [shirt, chinos, shoes] = PIECES as [(typeof PIECES)[0], (typeof PIECES)[0], (typeof PIECES)[0]];
  const tile = (p: (typeof PIECES)[0], pad = "9%") => (
    <View className="rounded-md" style={[p.style, { padding: pad as `${number}%`, backgroundColor: colors[p.ground] }]}>
      <ItemArt tags={p.tags as ItemTags} />
    </View>
  );
  return (
    // Decoration: the app name and tagline carry the screen's meaning, so the drawings stay out of the accessibility
    // tree (aria-hidden for web, the other two props for iOS and Android).
    <View
      aria-hidden
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{ flexDirection: "row", alignItems: "flex-start" }}
    >
      <View style={{ width: "56%", paddingTop: 24 }}>{tile({ ...shirt, style: { ...shirt.style, width: "100%" } })}</View>
      <View style={{ flex: 1, marginStart: -8 }}>
        {tile(chinos)}
        {/* Shoes sit in a wide, short frame and are height-limited; less padding lets them read at a glance. */}
        {tile(shoes, "3%")}
      </View>
    </View>
  );
}
