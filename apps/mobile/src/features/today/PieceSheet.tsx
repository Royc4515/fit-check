import type { Item } from "@fit-check/schema";
import { useTranslation } from "react-i18next";
import { Text, View } from "react-native";
import { Button, Meta, Sheet, Tile } from "../../components/ui";

/** Height / width of each alternative tile (the masonry's common shirt shape). */
const ALT_ASPECT = 1.25;

type Props = {
  /** The garment the sheet is about; null = closed. Kept by the caller through the closing animation. */
  piece: Item | null;
  open: boolean;
  /** Up to three engine alternatives for the slot (engine swapOptions). Absent = this outfit cannot be changed (worn). */
  alternatives: Item[] | null;
  onSwap: (item: Item) => void;
  onOpenItem: (id: string) => void;
  onClose: () => void;
};

/**
 * One piece of today's outfit (DESIGN.md section 3 "היום" item 3): titled with its name, up to three alternatives
 * as grid tiles (tap = swap and close, 2 taps from the screen), the "no alternatives" line, and a link to the item.
 */
export function PieceSheet({ piece, open, alternatives, onSwap, onOpenItem, onClose }: Props) {
  const { t } = useTranslation();
  const meta = (i: Item) => `${t(`item.subcategory.${i.tags.subcategory}`)} · ${t(`wardrobe.color.${i.tags.color_name}`)}`;
  return (
    <Sheet open={open && piece !== null} onClose={onClose} title={piece?.name} accessibilityLabel={piece?.name ?? t("today.title")}>
      {piece ? (
        <View style={{ gap: 16 }}>
          {/* ink-soft, a step firmer than the default meta: the only line that says what the titled garment is. */}
          <Meta tone="text-ink-soft">{meta(piece)}</Meta>
          {alternatives ? (
            alternatives.length > 0 ? (
              <View style={{ gap: 8 }}>
                <Meta tone="text-ink-soft">{t("today.alternatives")}</Meta>
                <View className="flex-row" style={{ gap: 8 }}>
                  {alternatives.map((o) => (
                    <View key={o.id} style={{ flex: 1 }}>
                      {/* One aspect for the row: alternatives can be different kinds (tee, button-down), and
                          type-based heights would stagger three captions that should read as one line. */}
                      <Tile item={o} aspect={ALT_ASPECT} caption={{ title: o.name, meta: meta(o) }} onPress={() => onSwap(o)} accessibilityLabel={t("today.swapTo", { name: o.name })} />
                    </View>
                  ))}
                  {/* Keep tiles at a third of the row when there are fewer than three, so a lone tile is not huge. */}
                  {Array.from({ length: 3 - alternatives.length }, (_, i) => (
                    <View key={`gap-${i}`} style={{ flex: 1 }} />
                  ))}
                </View>
              </View>
            ) : (
              <Text className="font-body text-body-sm text-ink-soft">{t("today.noAlternatives")}</Text>
            )
          ) : null}
          <Button variant="text" label={t("today.toItem")} onPress={() => onOpenItem(piece.id)} />
        </View>
      ) : null}
    </Sheet>
  );
}
