import type { PairWeights } from "@fit-check/engine";
import { AVAILABILITIES, type Availability, type Item, type ItemTags } from "@fit-check/schema";
import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Text, View } from "react-native";
import { SpecTable, type SpecRow } from "../../components/editorial/SpecTable";
import { Chip, Display, Meta, Segmented, StatusLine } from "../../components/ui";
import { hasSleeves, isBottom, legOf } from "../intake/tagRules";
import { editPayload, type ItemChange, type ItemEdits } from "./edit";
import { GoesWith } from "./GoesWith";
import { InlineText } from "./InlineText";
import { fieldLabelKey, TagSheet, type TagField } from "./TagSheet";

/** Numbers stay LTR inside Hebrew text (DESIGN.md section 2). */
const ltr = (s: string) => `⁦${s}⁩`;

/**
 * A status line under the part of the screen it is about: the name, the availability, or the very tag row that
 * failed (under the chip that just rolled back, not at the end of a table that may be below the fold).
 */
type Failure = { where: "identity" | "availability" | TagField };

type Props = {
  item: Item;
  items: Item[];
  pairWeights: PairWeights;
  onAvailability?: (itemId: string, next: Availability, prev: Availability) => Promise<void>;
  /** Absent in read-only contexts (no session): every chip is then plain text. */
  edits?: ItemEdits;
  /** A status about the picture (replacing, cutout fallback), shown first, right under the hero. */
  imageStatus?: ReactNode;
  onOpenOther: (scope: string, itemId: string) => void;
  onScrollTop: () => void;
  /** Phone layout: "goes with" runs to the screen edges. */
  bleed: boolean;
};

/**
 * Everything under the hero (DESIGN.md section 3 "פריט" items 2-5): the name and brand, edited in place; where the
 * item is; every tag as a chip in a labelled row, each opening its closed list in a sheet and saving on choice (no
 * edit mode, no save button); "goes with". Saves are optimistic upstream (the item route rolls back a failed write);
 * this component only says that it failed, next to what failed.
 */
export function ItemDetails({ item, items, pairWeights, onAvailability, edits, imageStatus, onOpenOther, onScrollTop, bleed }: Props) {
  const { t, i18n } = useTranslation();
  const [failure, setFailure] = useState<Failure | null>(null);
  const [field, setField] = useState<TagField | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const { tags } = item;
  // Names are often Latin inside a Hebrew page; aligned to the page's start, not to the script's (web gives text
  // dir="auto"), so a wrapped English name does not hang off the far edge.
  const align = { textAlign: i18n.language === "en" ? "left" : "right" } as const;

  /** The one save path: "the item as it is now + this change", built exactly like the old editor's payload. */
  const change = (c: ItemChange, where: Failure["where"]) => {
    if (!edits) return;
    const payload = editPayload(item, c);
    if (!payload) return;
    setFailure(null);
    edits.save(item.id, payload).catch((error: unknown) => {
      console.error("Item save failed", error);
      setFailure({ where });
    });
  };

  const changeAvailability = onAvailability
    ? (next: Availability) => {
        setFailure(null);
        onAvailability(item.id, next, item.availability).catch((error: unknown) => {
          console.error("Availability update failed", error);
          setFailure({ where: "availability" });
        });
      }
    : undefined;

  const openField = (f: TagField) => {
    setField(f);
    setSheetOpen(true);
  };

  /** A tag value as a chip: a button that names the field and the value ("Colour: navy, edit"). Text when read-only. */
  const value = (f: TagField, label: string, opts: { swatch?: string; key?: string; dashed?: boolean } = {}) =>
    edits ? (
      <Chip
        key={opts.key ?? f}
        label={label}
        swatch={opts.swatch}
        dashed={opts.dashed}
        onPress={() => openField(f)}
        accessibilityLabel={t("item.editField", { field: t(fieldLabelKey[f]), value: label })}
      />
    ) : (
      <Text key={opts.key ?? f} className="font-body text-body text-ink">
        {label}
      </Text>
    );

  const failed = (where: Failure["where"], message: string) =>
    failure?.where === where ? (
      <View className="mt-2">
        <StatusLine variant="error" message={message} />
      </View>
    ) : null;

  /** One tag row: its chip(s), and the failure line under them when this field's save was just rolled back. */
  const row = (f: TagField, content: ReactNode): SpecRow => ({
    key: f,
    label: t(fieldLabelKey[f]),
    value: (
      <View style={{ alignSelf: "stretch", alignItems: "flex-start" }}>
        <View className="flex-row flex-wrap" style={{ gap: 8 }}>
          {content}
        </View>
        {failed(f, t("item.saveFailed"))}
      </View>
    ),
  });

  const rows: SpecRow[] = [
    row("subcategory", value("subcategory", t(`item.subcategory.${tags.subcategory}`))),
    row("color", value("color", t(`wardrobe.color.${tags.color_name}`), { swatch: tags.color_hex })),
    row("pattern", value("pattern", t(`item.pattern.${tags.pattern}`))),
    // "Unknown" material says nothing; read-only it is dropped, editable it is an invitation to fill in.
    ...(tags.material !== "unknown"
      ? [row("material", value("material", t(`item.material.${tags.material}`)))]
      : edits
        ? [row("material", value("material", t("item.addMaterial"), { dashed: true }))]
        : []),
    ...(hasSleeves(tags) ? [row("sleeve", value("sleeve", t(`item.sleeve.${tags.sleeve === "na" ? "short" : tags.sleeve}`)))] : []),
    ...(isBottom(tags) ? [row("leg", value("leg", t(`item.leg.${legOf(tags)}`)))] : []),
    row("fit", value("fit", t(`item.fit.${tags.fit}`))),
    row("seasons", tags.seasons.map((s) => value("seasons", t(`wardrobe.season.${s}`), { key: s }))),
    row("formality", value("formality", ltr(`${tags.formality}/10`))),
    // Derived from the other tags by the tagger, so it is read, not chosen: no chip.
    {
      key: "range",
      label: t("item.spec.range"),
      value: <Text className="font-mono text-num text-ink">{ltr(`${tags.temp_min_c}–${tags.temp_max_c}°`)}</Text>,
    },
  ];

  return (
    <View>
      {imageStatus ? <View className="mb-6">{imageStatus}</View> : null}

      {edits ? (
        <InlineText value={item.name} label={t("item.edit.name")} size="display-xl" onCommit={(name) => change({ name }, "identity")}>
          <Display size="display-xl" style={align}>
            {item.name}
          </Display>
        </InlineText>
      ) : (
        <Display size="display-xl" style={align}>
          {item.name}
        </Display>
      )}
      <View className="mt-1">
        {edits ? (
          <InlineText value={item.brand ?? ""} label={t("item.edit.brand")} size="body-sm" onCommit={(brand) => change({ brand }, "identity")}>
            {item.brand ? (
              <Text className="font-body text-body-sm text-ink-soft">{item.brand}</Text>
            ) : (
              <View className="border-b border-hairline pb-1">
                <Text className="font-body text-body-sm text-ink-faint">{t("item.addBrand")}</Text>
              </View>
            )}
          </InlineText>
        ) : item.brand ? (
          <Text className="font-body text-body-sm text-ink-soft">{item.brand}</Text>
        ) : null}
      </View>
      {failed("identity", t("item.saveFailed"))}

      <View className="mt-12">
        <Meta>{t("item.where")}</Meta>
        <View className="mt-2">
          <Segmented
            segments={AVAILABILITIES.map((a) => ({ key: a, label: t(`wardrobe.availability.${a}`) }))}
            value={item.availability}
            onChange={(a) => changeAvailability?.(a)}
            disabled={!changeAvailability}
            accessibilityLabel={t("item.where")}
          />
        </View>
        {item.availability !== "home" ? <Text className="mt-3 font-body text-body-sm text-ink-soft">{t("item.notSuggested")}</Text> : null}
        {failed("availability", t("item.availabilityFailed"))}
      </View>

      <View className="mt-12">
        <SpecTable rows={rows} />
      </View>

      <View className="mt-12">
        <GoesWith item={item} items={items} pairWeights={pairWeights} onOpen={onOpenOther} onSelf={onScrollTop} bleed={bleed} />
      </View>

      {edits ? (
        <TagSheet
          field={field}
          open={sheetOpen}
          item={item}
          onPick={(patch: Partial<ItemTags>) => field && change({ tags: patch }, field)}
          onClose={() => setSheetOpen(false)}
        />
      ) : null}
    </View>
  );
}
