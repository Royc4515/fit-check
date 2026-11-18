import type { PairWeights } from "@fit-check/engine";
import type { Item, Slot } from "@fit-check/schema";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { ScrollView, View } from "react-native";
import { Display, FlatLay, flatLayTone, type FlatLayPiece } from "../../components/ui";
import { layout } from "../../theme/tokens";
import { getOutfitsWith } from "../today/outfit";
import { outfitIndex } from "../today/pieces";
import { registerOrigin } from "./transition";
import { spoken } from "./a11y";

/** One outfit surface: small enough that two and a bit show on a phone, so the row reads as scrollable. */
const SURFACE_W = 160;
/** Engine outfits shown (DESIGN.md section 3 "פריט" item 5). */
const MAX_OUTFITS = 3;

/** The origin scope of one "goes with" surface: one per outfit, as the same shoes can be in all three. */
export const goesWithScope = (itemId: string, outfitId: string) => `goes-with:${itemId}:${outfitId}`;

type Props = {
  item: Item;
  items: Item[];
  pairWeights: PairWeights;
  /** A garment of another item was pressed: open it, flying from the pressed garment. */
  onOpen: (scope: string, itemId: string) => void;
  /** This item's own garment was pressed: it is already open, so take the reader back up to it. */
  onSelf: () => void;
  /** Phone: the row runs to the screen edges (a horizontal row cut by the gutter looks clipped, not scrollable). */
  bleed: boolean;
};

/**
 * "Goes with" (DESIGN.md section 3 "פריט" item 5): up to three engine outfits that contain this item, each a small
 * flat-lay, Today's language at a glance, in one horizontally scrolling row. Every garment is a button to its item and
 * the origin of that item's shared-element flight. Nothing renders when the engine finds no outfit.
 */
export function GoesWith({ item, items, pairWeights, onOpen, onSelf, bleed }: Props) {
  const { t } = useTranslation();
  const outfits = useMemo(() => getOutfitsWith(items, pairWeights, item.id, MAX_OUTFITS), [items, pairWeights, item.id]);
  const byId = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  if (outfits.length === 0) return null;

  return (
    <View>
      <Display>{t("item.goesWith")}</Display>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={{ marginTop: 16, marginHorizontal: bleed ? -layout.gutter : 0 }}
        contentContainerStyle={{ gap: 8, paddingHorizontal: bleed ? layout.gutter : 0 }}
      >
        {outfits.map((outfit, n) => {
          const scope = goesWithScope(item.id, outfit.outfit_id);
          const pieces: FlatLayPiece[] = outfit.items.flatMap((p) => {
            const full = byId.get(p.id);
            if (!full) return [];
            const type = t(`item.subcategory.${full.tags.subcategory}`);
            const self = full.id === item.id;
            return [
              {
                slot: p.slot,
                item: full,
                index: outfitIndex(outfit.items, p.id),
                accessibilityLabel: spoken(self ? t("item.goesWithSelf", { type, name: full.name }) : t("item.goesWithPiece", { type, name: full.name })),
              },
            ];
          });
          const tone = flatLayTone(pieces);
          const pressed = (slot: Slot) => {
            const id = pieces.find((p) => p.slot === slot)?.item.id;
            if (!id) return;
            if (id === item.id) onSelf();
            else onOpen(scope, id);
          };
          return (
            <View key={outfit.outfit_id} style={{ width: SURFACE_W }}>
              <FlatLay
                pieces={pieces}
                numbered={false}
                onPressPiece={pressed}
                onPieceNode={(id, node) => registerOrigin(scope, id, node, { tone, loose: true })}
                accessibilityLabel={spoken(t("item.goesWithOutfit", { n: n + 1, pieces: pieces.map((p) => p.item.name).join(", ") }))}
              />
            </View>
          );
        })}
      </ScrollView>
    </View>
  );
}
