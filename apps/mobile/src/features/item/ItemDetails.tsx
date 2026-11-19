import type { PairWeights } from "@fit-check/engine";
import { AVAILABILITIES, type Availability, type Item, type ItemTags } from "@fit-check/schema";
import { useCallback, useEffect, useRef, useState, type MutableRefObject, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Text, View } from "react-native";
import { SpecTable, type SpecRow } from "../../components/editorial/SpecTable";
import { Chip, Display, Meta, Segmented, StatusLine } from "../../components/ui";
import { reasonOf } from "../../data/intake";
import { failureMessage } from "../intake/failure";
import { hasSleeves, isBottom, legOf } from "../intake/tagRules";
import { NOTES_COUNTER_FROM, NOTES_MAX, type ItemChange, type ItemEdits } from "./edit";
import { GoesWith } from "./GoesWith";
import { InlineText, NotesPencil } from "./InlineText";
import { useTextWriting } from "./useTextWriting";
import { fieldLabelKey, TagSheet, type TagField } from "./TagSheet";
import { useItemWears } from "./useItemWears";
import { WearHistory } from "./WearHistory";
import { spoken } from "./a11y";

/** Numbers stay LTR inside Hebrew text (DESIGN.md section 2). */
const ltr = (s: string) => `⁦${s}⁩`;

/**
 * A status line under the part of the screen it is about: the name, the availability, or the very tag row that
 * failed (under the chip that just rolled back, not at the end of a table that may be below the fold).
 */
type Failure = { where: "availability" | TagField };

type Props = {
  item: Item;
  items: Item[];
  pairWeights: PairWeights;
  onAvailability?: (itemId: string, next: Availability) => Promise<void>;
  /** Absent in read-only contexts (no session): every chip is then plain text. */
  edits?: ItemEdits;
  /** A status about the picture (replacing, cutout fallback), shown first, right under the hero. */
  imageStatus?: ReactNode;
  onOpenOther: (scope: string, itemId: string) => void;
  onScrollTop: () => void;
  /** Phone layout: "goes with" runs to the screen edges. */
  bleed: boolean;
  /**
   * Filled with this screen's "leaving now" hook: the screen calls it before it goes (back, hardware back, another
   * item), so an open, changed, valid text field is saved rather than thrown away (DESIGN.md section 4).
   */
  flushRef?: MutableRefObject<(() => void) | null>;
};

/**
 * Everything under the hero (DESIGN.md section 3 "פריט" items 2-5 and "שלב 2"): the name and brand, edited in place;
 * where the item is; every tag as a chip in a labelled row, each opening its closed list in a sheet and saving on
 * choice (no edit mode, no save button); the notes, edited in place; the wear history; "goes with". Saves are optimistic upstream (the item route rolls back a failed write);
 * this component only says that it failed, next to what failed.
 */
export function ItemDetails({ item, items, pairWeights, onAvailability, edits, imageStatus, onOpenOther, onScrollTop, bleed, flushRef }: Props) {
  const { t } = useTranslation();
  const [failure, setFailure] = useState<Failure | null>(null);
  // A write can fail after the screen is gone (back right after an edit): the wardrobe store is still rolled back by
  // the edit queue (editQueue.ts), only the line here has nobody left to show it to.
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const fail = (where: Failure["where"]) => {
    if (mounted.current) setFailure({ where });
  };
  const itemId = item.id;
  const save = edits?.save;
  const saveText = useCallback((c: ItemChange) => (save ? save(itemId, c) : Promise.resolve()), [save, itemId]);
  const failureText = useCallback(
    (error: unknown) => {
      const reason = reasonOf(error);
      const why = reason === "preview" || reason.startsWith("http_") ? failureMessage(t, reason) : t("item.writing.failedUnknown");
      return t("item.writing.failed", { reason: why });
    },
    [t]
  );
  const writing = useTextWriting(edits ? saveText : null, failureText);
  const { flush } = writing;
  // Leaving the screen with a field open saves it (changed and valid) through the edit queue, which settles the
  // wardrobe store even after this screen is gone. Unmount covers browser back; the screen calls `flushRef` earlier.
  useEffect(() => {
    if (flushRef) flushRef.current = flush;
  }, [flushRef, flush]);
  const flushOnUnmount = useRef(flush);
  useEffect(() => {
    flushOnUnmount.current = flush;
  }, [flush]);
  useEffect(() => {
    const holder = flushOnUnmount;
    return () => holder.current();
  }, []);
  const [field, setField] = useState<TagField | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  // The item as it was when the screen opened: a pick back to it restores it exactly (edit.ts colorPatch/legPatch).
  const [baseline] = useState(item.tags);
  const wears = useItemWears(item.id);
  const { tags } = item;
  /**
   * An error line belongs to the action that produced it: any next action on these details (opening a sheet,
   * starting or cancelling an inline edit, another availability pick) is a retry or a move on, and clears it.
   */
  const moveOn = () => setFailure(null);
  // Names are often Latin inside a Hebrew page; aligned to the page's start, not to the script's (web gives text
  // dir="auto"), so a wrapped English name does not hang off the far edge. Logical `start`: resolved from the layout
  // direction, which on native is the drawn one even before a restart (verification D9).
  const align = { textAlign: "start" } as const;

  /**
   * The one save path: the change goes to the item route, which applies it to the item as currently shown (pending
   * edits included) and queues the write; a no-op change resolves at once without a write.
   */
  const change = (c: ItemChange, where: Failure["where"]) => {
    if (!edits) return;
    setFailure(null);
    edits.save(item.id, c).catch((error: unknown) => {
      console.error("Item save failed", error);
      fail(where);
    });
  };

  const changeAvailability = onAvailability
    ? (next: Availability) => {
        setFailure(null);
        onAvailability(item.id, next).catch((error: unknown) => {
          console.error("Availability update failed", error);
          fail("availability");
        });
      }
    : undefined;

  const openField = (f: TagField) => {
    moveOn();
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
        accessibilityLabel={spoken(t("item.editField", { field: t(fieldLabelKey[f]), value: label }))}
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
        <InlineText
          field="name"
          value={item.name}
          writing={writing}
          label={t("item.edit.name")}
          editLabel={t("item.writing.editName")}
          size="display-xl"
          headingLevel={1}
        >
          <Display size="display-xl" level={null} style={align}>
            {item.name}
          </Display>
        </InlineText>
      ) : (
        <Display size="display-xl" level={1} style={align}>
          {item.name}
        </Display>
      )}
      <View className="mt-1">
        {edits ? (
          <InlineText
            field="brand"
            value={item.brand ?? ""}
            writing={writing}
            label={t("item.edit.brand")}
            editLabel={t("item.writing.editBrand")}
            emptyText={t("item.addBrand")}
            size="body-sm"
          >
            <Text className="font-body text-body-sm text-ink-soft" style={align}>
              {item.brand}
            </Text>
          </InlineText>
        ) : item.brand ? (
          <Text className="font-body text-body-sm text-ink-soft">{item.brand}</Text>
        ) : null}
      </View>

      <View className="mt-12">
        <Meta>{t("item.where")}</Meta>
        <View className="mt-2">
          <Segmented
            segments={AVAILABILITIES.map((a) => ({ key: a, label: t(`wardrobe.availability.${a}`) }))}
            value={item.availability}
            onChange={(a) => changeAvailability?.(a)}
            disabled={!onAvailability}
            accessibilityLabel={spoken(t("item.where"))}
          />
        </View>
        {item.availability !== "home" ? <Text className="mt-3 font-body text-body-sm text-ink-soft">{t("item.notSuggested")}</Text> : null}
        {failed("availability", t("item.availabilityFailed"))}
      </View>

      <View className="mt-8">
        <SpecTable rows={rows} />
      </View>

      {/* Notes: free text written in place (DESIGN.md section 4), the pencil at the end of the heading row. Read-only
          and empty, there is nothing to show. */}
      {edits || item.notes ? (
        <View className="mt-12">
          <View className="flex-row items-center justify-between" style={{ gap: 8 }}>
            <Display>{t("item.notes.title")}</Display>
            {edits ? <NotesPencil writing={writing} value={item.notes ?? ""} label={t("item.writing.editNotes")} /> : null}
          </View>
          <View className="mt-4">
            {edits ? (
              <InlineText
                field="notes"
                value={item.notes ?? ""}
                writing={writing}
                label={t("item.notes.title")}
                editLabel={t("item.writing.editNotes")}
                emptyText={t("item.notes.add")}
                placeholder={t("item.notes.add")}
                size="body"
                multiline
                maxLength={NOTES_MAX}
                counterFrom={NOTES_COUNTER_FROM}
                pencilElsewhere
              >
                <Text className="font-body text-body text-ink" style={align}>
                  {item.notes}
                </Text>
              </InlineText>
            ) : (
              <Text className="font-body text-body text-ink" style={align}>
                {item.notes}
              </Text>
            )}
          </View>
        </View>
      ) : null}

      <View className="mt-12">
        <WearHistory itemId={item.id} items={items} state={wears.state} onRetry={wears.retry} />
      </View>

      <View className="mt-12">
        <GoesWith item={item} items={items} pairWeights={pairWeights} onOpen={onOpenOther} onSelf={onScrollTop} bleed={bleed} />
      </View>

      {edits ? (
        <TagSheet
          field={field}
          open={sheetOpen}
          item={item}
          baseline={baseline}
          onPick={(patch: Partial<ItemTags>) => field && change({ tags: patch }, field)}
          onClose={() => setSheetOpen(false)}
        />
      ) : null}
    </View>
  );
}
