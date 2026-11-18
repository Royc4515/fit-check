import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { Button, Chip, Meta, Sheet } from "../../components/ui";
import type { SheetFacet, Selection } from "./filters";

type Props = {
  open: boolean;
  onClose: () => void;
  facets: readonly { facet: SheetFacet; values: string[] }[];
  selection: Selection;
  onToggle: (facet: SheetFacet, value: string) => void;
  /** Clears the sheet's facets only; category and colour are on the screen and stay as they are. */
  onClear: () => void;
  /** How many items the current filters show; filters apply live, so this is what "show" closes onto. */
  count: number;
};

const ltr = (n: number) => `⁦${n}⁩`;

/**
 * "סינון" (DESIGN.md section 3 "ארון" item 7): type, season and availability as rows of chips, single choice per
 * row (tap again clears it). Every tap applies at once behind the sheet; "show N" only closes it, so the number on
 * it is always the grid the user is about to see.
 */
export function FilterSheet({ open, onClose, facets, selection, onToggle, onClear, count }: Props) {
  const { t } = useTranslation();
  const any = facets.some(({ facet }) => selection[facet] !== undefined);
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={t("wardrobe.filter.title")}
      footer={
        <View className="flex-row items-center justify-between" style={{ gap: 16 }}>
          <Button variant="text" label={t("wardrobe.filter.clear")} onPress={onClear} disabled={!any} />
          <Button variant="ink" label={t("wardrobe.filter.show", { count, n: ltr(count) })} onPress={onClose} />
        </View>
      }
    >
      {facets.map(({ facet, values }, i) => (
        <View key={facet} className={i === 0 ? "mt-2" : "mt-6"}>
          <Meta tone="text-ink-soft">{t(`wardrobe.filter.facet.${facet}`)}</Meta>
          <View className="mt-2 flex-row flex-wrap" style={{ gap: 8 }}>
            {values.map((value) => (
              <Chip
                key={value}
                label={t(`wardrobe.${facet}.${value}`)}
                selected={selection[facet] === value}
                onPress={() => onToggle(facet, value)}
              />
            ))}
          </View>
        </View>
      ))}
    </Sheet>
  );
}
