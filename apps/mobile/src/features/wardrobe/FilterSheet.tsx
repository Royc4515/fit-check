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
};

/**
 * "סינון" (DESIGN.md section 3 "ארון" item 7): type, season and availability as rows of chips, single choice per
 * row. A chip tap applies the filter and closes the sheet (tune + chip = 2 taps from the screen); tapping the
 * chosen chip clears that facet and closes too. "נקה" clears the sheet's facets and closes.
 */
export function FilterSheet({ open, onClose, facets, selection, onToggle, onClear }: Props) {
  const { t } = useTranslation();
  const any = facets.some(({ facet }) => selection[facet] !== undefined);
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={t("wardrobe.filter.title")}
      footer={
        <Button
          variant="text"
          label={t("wardrobe.filter.clear")}
          onPress={() => {
            onClear();
            onClose();
          }}
          disabled={!any}
        />
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
                onPress={() => {
                  onToggle(facet, value);
                  onClose();
                }}
              />
            ))}
          </View>
        </View>
      ))}
    </Sheet>
  );
}
