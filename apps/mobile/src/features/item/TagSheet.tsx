import { COLOR_NAMES, FITS, MATERIALS, PATTERNS, SEASONS, SUBCATEGORIES, type Item, type ItemTags, type Season } from "@fit-check/schema";
import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { Button, Chip, Meta, Sheet } from "../../components/ui";
import { LEG_CHOICES, legOf, SLEEVE_CHOICES, subcategoryForLeg } from "../intake/tagRules";
import { colorHexFor, colorPatch } from "./edit";

/** The editable tag fields of the item screen, one closed list each. */
export type TagField = "subcategory" | "color" | "pattern" | "material" | "sleeve" | "leg" | "fit" | "seasons" | "formality";

/** The field's name, as the row label and the sheet title. */
export const fieldLabelKey: Record<TagField, string> = {
  subcategory: "item.spec.type",
  color: "item.spec.color",
  pattern: "item.spec.pattern",
  material: "item.spec.material",
  sleeve: "item.spec.sleeve",
  leg: "item.spec.leg",
  fit: "item.spec.fit",
  seasons: "item.spec.seasons",
  formality: "item.spec.formality",
};

const FORMALITY = Array.from({ length: 10 }, (_, i) => i + 1);
/** Formality as two rows of five equal chips: ten in one row do not fit a phone at chip size. */
const FORMALITY_ROW = 5;

type Props = {
  /** The field being edited; kept by the caller through the closing animation. */
  field: TagField | null;
  open: boolean;
  item: Item;
  /** One tag patch, already in the shape the old editor patched (normalised later, in one place). */
  onPick: (patch: Partial<ItemTags>) => void;
  onClose: () => void;
};

/**
 * The closed list behind one tag chip (DESIGN.md section 3 "פריט" item 4): a sheet titled with the field, its values
 * as chips, the current one selected. Choosing closes the sheet and saves at once. Seasons are the one multi-select:
 * they toggle in the sheet and save on "done", never leaving fewer than one.
 */
export function TagSheet({ field, open, item, onPick, onClose }: Props) {
  const { t } = useTranslation();
  const title = field ? t(fieldLabelKey[field]) : "";
  const pick = (patch: Partial<ItemTags>) => {
    onPick(patch);
    onClose();
  };
  const seasons = field === "seasons";
  // The seasons draft starts from what is stored at every opening (derived during render, not in an effect, so the
  // first frame of the sheet already shows it).
  const [draft, setDraft] = useState<readonly Season[]>(item.tags.seasons);
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setDraft(item.tags.seasons);
  }
  const toggle = (s: Season) => {
    const has = draft.includes(s);
    // At least one season: the schema requires it, and an item with none would never be suggested.
    if (has && draft.length === 1) return;
    setDraft(has ? draft.filter((x) => x !== s) : SEASONS.filter((x) => x === s || draft.includes(x)));
  };
  const changed = draft.length !== item.tags.seasons.length || draft.some((s) => !item.tags.seasons.includes(s));

  return (
    <Sheet
      open={open && field !== null}
      onClose={onClose}
      title={title}
      footer={seasons ? <Button variant="ink" fullWidth label={t("item.done")} onPress={() => pick(changed ? { seasons: [...draft] } : {})} /> : undefined}
    >
      {field && !seasons ? <Values field={field} item={item} onPick={pick} /> : null}
      {seasons ? (
        <View style={{ gap: 16 }}>
          <ChipWrap>
            {SEASONS.map((s) => (
              <Chip key={s} label={t(`wardrobe.season.${s}`)} selected={draft.includes(s)} onPress={() => toggle(s)} />
            ))}
          </ChipWrap>
          <Meta tone="text-ink-soft">{t("item.seasonsHint")}</Meta>
        </View>
      ) : null}
    </Sheet>
  );
}

/** Wrapping chips, so the whole closed list is visible at once: in a sheet nothing should hide off-screen. */
function ChipWrap({ children }: { children: ReactNode }) {
  return (
    <View className="flex-row flex-wrap" style={{ gap: 8 }}>
      {children}
    </View>
  );
}

function Values({ field, item, onPick }: { field: Exclude<TagField, "seasons">; item: Item; onPick: (patch: Partial<ItemTags>) => void }) {
  const { t } = useTranslation();
  const { tags } = item;
  const list = <T extends string>(values: readonly T[], selected: T, label: (v: T) => string, patch: (v: T) => Partial<ItemTags>) => (
    <ChipWrap>
      {values.map((v) => (
        <Chip key={v} label={label(v)} selected={v === selected} onPress={() => (v === selected ? onPick({}) : onPick(patch(v)))} />
      ))}
    </ChipWrap>
  );
  switch (field) {
    case "subcategory":
      return list(SUBCATEGORIES, tags.subcategory, (v) => t(`item.subcategory.${v}`), (v) => ({ subcategory: v }));
    case "color":
      return (
        <ChipWrap>
          {COLOR_NAMES.map((c) => (
            <Chip
              key={c}
              label={t(`wardrobe.color.${c}`)}
              swatch={colorHexFor(item, c)}
              selected={c === tags.color_name}
              onPress={() => onPick(c === tags.color_name ? {} : colorPatch(item, c))}
            />
          ))}
        </ChipWrap>
      );
    case "pattern":
      return list(PATTERNS, tags.pattern, (v) => t(`item.pattern.${v}`), (v) => ({ pattern: v }));
    case "material":
      return list(MATERIALS, tags.material, (v) => t(`item.material.${v}`), (v) => ({ material: v }));
    case "sleeve":
      return list(SLEEVE_CHOICES, tags.sleeve === "na" ? "short" : tags.sleeve, (v) => t(`item.sleeve.${v}`), (v) => ({ sleeve: v }));
    case "leg":
      return list(LEG_CHOICES, legOf(tags), (v) => t(`item.leg.${v}`), (v) => ({ subcategory: subcategoryForLeg(v, tags, tags.subcategory) }));
    case "fit":
      return list(FITS, tags.fit, (v) => t(`item.fit.${v}`), (v) => ({ fit: v }));
    case "formality":
      return (
        <View style={{ gap: 8 }}>
          {[0, 1].map((row) => (
            <View key={row} className="flex-row" style={{ gap: 8 }}>
              {FORMALITY.slice(row * FORMALITY_ROW, (row + 1) * FORMALITY_ROW).map((n) => (
                <Chip
                  key={n}
                  stretch
                  label={`⁦${n}⁩`}
                  accessibilityLabel={t("item.formalityValue", { n })}
                  selected={n === tags.formality}
                  onPress={() => onPick(n === tags.formality ? {} : { formality: n })}
                />
              ))}
            </View>
          ))}
        </View>
      );
  }
}
