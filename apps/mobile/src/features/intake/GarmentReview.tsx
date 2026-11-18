import {
  COLOR_NAMES,
  FITS,
  MATERIALS,
  PATTERNS,
  SUBCATEGORIES,
  SUBCATEGORY_TO_CATEGORY,
  type ItemTags,
  type RedrawSpec,
  type TagProposal,
} from "@fit-check/schema";
import type { TFunction } from "i18next";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { TextInput, View } from "react-native";
import { cutoutUrl } from "../../components/item-art/ItemArt";
import { Button, Meta, PhotoTile, Skeleton, StatusLine } from "../../components/ui";
import { tileTone } from "../../theme/tileTone";
import { RedrawComposer } from "../redraw/RedrawComposer";
import { Row } from "./ChoiceRow";
import { failureMessage, isRetryable } from "./failure";
import { COLOR_HEX } from "./palette";
import { hasSleeves, isBottom, LEG_CHOICES, legOf, normalizeTags, SLEEVE_CHOICES, subcategoryForLeg } from "./tagRules";

export type Draft = { name: string; brand: string | null; tags: ItemTags };

export type ReviewState = {
  url: string;
  issues: string[];
  enhanced?: boolean;
  enhancing?: boolean;
  enhanceError?: string;
  tagging?: boolean;
  /** Background removal in progress; the crop is shown meanwhile. */
  cutting?: boolean;
  /** Why the original crop's background could not be removed; the crop is kept as it is. */
  cutError?: string;
  /** Why the redraw's background could not be removed; the redraw stays on its white ground. */
  redrawCutError?: string;
  tagError?: string;
  proposal?: TagProposal;
  draft?: Draft;
  labelling?: boolean;
  saving?: boolean;
  saved?: boolean;
  /** A late cutout is being written to the saved item. */
  syncing?: boolean;
  /** The saved item could not be updated with the late cutout. */
  syncError?: boolean;
  /** The redraw's spec could not be stored on the saved item (the image itself was saved). */
  specError?: boolean;
  /** The tagger's corrections could not be stored (the item itself was saved). */
  correctionError?: boolean;
  /** One-garment mode found nothing separately and kept the whole photo. */
  wholePhoto?: boolean;
  /** Set on save, so a cutout that finishes later can still update the saved item. */
  itemId?: string;
  /** A wardrobe item the checker thinks is this same garment, until the user answers. */
  duplicate?: { item_id: string; name: string; image_path: string } | null;
  /** The user chose to put this photo on the existing item instead of adding a new one. */
  replaced?: boolean;
  /** Why the last save (or replace) failed. */
  saveError?: string;
  skipped?: boolean;
};

type Props = {
  garment: ReviewState;
  /** Detection's short description: the redraw composer reads collar, pockets and logos off it. */
  description?: string;
  /** A write for this garment is in flight: its actions are inert until it lands. */
  busy: boolean;
  onChange: (draft: Draft) => void;
  onSave: () => void;
  onSkip: () => void;
  /** Paid redraw with the composer's spec. */
  onEnhance: (spec: RedrawSpec) => void;
  onLabel: () => void;
  onRetryTag: () => void;
  onRetake: () => void;
  /** Answers to the duplicate notice: not the same garment / skip this one / use this photo on the existing item. */
  onNotDuplicate: () => void;
  onReplaceExisting: () => void;
  /** Retries of the three background steps that fail without stopping the flow. */
  onRetryCut: () => void;
  onRetryRedrawCut: () => void;
  onRetrySync: () => void;
};

/** Which uncertain flag belongs to which row: the tagger reports "color", the row edits color_name. */
const UNCERTAIN_KEY = { subcategory: "subcategory", color_name: "color", pattern: "pattern", material: "material", fit: "fit" } as const;

/** Meta is uppercase and tracked in English; these are sentences, not labels. */
const SENTENCE = { textTransform: "none", letterSpacing: 0 } as const;

/** Portrait box for a garment photo: tall enough for trousers, the same ratio for every card so the grid is even. */
const IMAGE_ASPECT = 1.25;
/** The image takes this share of the card's width next to the name; the rest is the name and its notes. */
const IMAGE_SHARE = "40%";

/** The saved-failure line: the preview block, an HTTP status, or the plain "did not save". */
function saveMessage(t: TFunction, reason: string): string {
  if (reason === "preview" || /^http_\d{3}$/.test(reason)) return failureMessage(t, reason, "save");
  return t("intake.review.saveFailed");
}

/**
 * Review of one garment before it enters the wardrobe: the tagger's proposal as chips, one tap to change any field.
 * Fields the tagger was unsure of are marked, so the eye goes there first. Nothing is saved until "save".
 * Every step that can fail says so here, in a status line with its reason, and offers a retry where one helps.
 * Presentational: state comes in as props, so the design gallery renders every state from fixtures.
 */
export function GarmentReview({
  garment: g,
  description,
  busy,
  onChange,
  onSave,
  onSkip,
  onEnhance,
  onLabel,
  onRetryTag,
  onRetake,
  onNotDuplicate,
  onReplaceExisting,
  onRetryCut,
  onRetryRedrawCut,
  onRetrySync,
}: Props) {
  const { t, i18n } = useTranslation();
  const [composing, setComposing] = useState(false);
  const d = g.draft;
  const unsure = new Set(g.proposal?.uncertain ?? []);
  const setTags = (patch: Partial<ItemTags>) => d && onChange({ ...d, tags: normalizeTags({ ...d.tags, ...patch }) });
  // Ground for the photo: from the colour the tagger measured, or the draft's once the user changed it.
  const tone = tileTone(d?.tags.color_hex ?? g.proposal?.tags.color_hex);

  if (g.skipped) return null;

  if (g.replaced) {
    return (
      <View className="flex-row items-center" style={{ gap: 16 }}>
        <PhotoTile uri={g.url} tone={tone} size="mini" width={64} aspect={IMAGE_ASPECT} accessibilityLabel={t("intake.review.photo")} />
        <View className="flex-1">
          <StatusLine variant="ok" message={t("intake.duplicate.replaced", { name: g.duplicate?.name ?? "" })} />
          {g.syncError ? <StatusLine variant="error" message={t("intake.fail.sync")} action={{ label: t("intake.fail.retry"), onPress: onRetrySync }} disabled={busy} /> : null}
        </View>
      </View>
    );
  }

  // Asked before anything else: reviewing tags for a garment that is already in the wardrobe is wasted effort.
  if (g.duplicate && !g.saved) {
    return (
      <View>
        <StatusLine variant="info" message={t("intake.duplicate.title", { name: g.duplicate.name })} />
        <View className="mt-3 flex-row" style={{ gap: 12 }}>
          {[
            { uri: g.url, label: t("intake.duplicate.new") },
            { uri: cutoutUrl(g.duplicate.image_path), label: t("intake.duplicate.existing") },
          ].map((side) => (
            <View key={side.label} style={{ flex: 1, maxWidth: 160 }}>
              <PhotoTile uri={side.uri} tone={tone} size="grid" aspect={IMAGE_ASPECT} accessibilityLabel={side.label} />
              <Meta className="mt-2">{side.label}</Meta>
            </View>
          ))}
        </View>
        <View className="mt-4 flex-row flex-wrap items-center" style={{ columnGap: 12, rowGap: 8 }}>
          <Button variant="ink" label={t("intake.duplicate.same")} disabled={busy} onPress={onSkip} />
          <Button
            variant="outline"
            label={g.saving ? t("intake.review.saving") : t("intake.duplicate.replace")}
            disabled={busy}
            onPress={onReplaceExisting}
          />
          <Button variant="text" label={t("intake.duplicate.different")} disabled={busy} onPress={onNotDuplicate} />
        </View>
        {g.saveError ? (
          <StatusLine
            variant="error"
            message={saveMessage(t, g.saveError)}
            action={isRetryable(g.saveError) ? { label: t("intake.fail.retry"), onPress: onReplaceExisting } : undefined}
            disabled={busy}
          />
        ) : null}
      </View>
    );
  }

  const retry = (onPress: () => void) => ({ label: t("intake.fail.retry"), onPress });
  const preview = (reason?: string) => reason === "preview";

  return (
    <View>
      <View className="flex-row" style={{ gap: 16 }}>
        <PhotoTile uri={g.url} tone={tone} size="grid" width={IMAGE_SHARE} aspect={IMAGE_ASPECT} accessibilityLabel={t("intake.review.photo")} />
        <View className="flex-1" style={{ gap: 8 }}>
          {g.proposal?.label_composition ? <Meta tone="text-ink-soft" style={SENTENCE}>{t("intake.review.label", { text: g.proposal.label_composition })}</Meta> : null}
          {g.issues.length > 0 && !g.enhanced ? (
            <Meta tone="text-ink-soft" style={SENTENCE}>{g.issues.map((i) => t(`intake.issue.${i}`)).join(" · ")}</Meta>
          ) : null}
        </View>
      </View>

      {/* Under the photo, full width: a long name ("Kenneth Cole Coat, navy") must not be clipped to half a card. */}
      <View className="mt-4">
        {d ? (
          <TextInput
            value={d.name}
            onChangeText={(name) => onChange({ ...d, name })}
            accessibilityLabel={t("intake.review.name")}
            editable={!g.saved}
            className="border-b border-hairline pb-1 font-body-semibold text-title text-ink"
            style={{ textAlign: i18n.language === "en" ? "left" : "right" }}
          />
        ) : (
          // The name field's own place, so the card does not jump when the proposal arrives.
          <Skeleton height={36} />
        )}
      </View>

      <View className="mt-2">
        {g.tagging ? <StatusLine variant="info" message={t("intake.review.tagging")} /> : null}
        {g.labelling ? <StatusLine variant="info" message={t("intake.review.labelling")} /> : null}
        {g.tagError ? (
          <StatusLine
            variant="error"
            message={failureMessage(t, g.tagError)}
            action={isRetryable(g.tagError) ? { label: t("intake.review.retryTag"), onPress: onRetryTag } : undefined}
            disabled={busy}
          />
        ) : null}
        {g.cutting ? <StatusLine variant="info" message={t("intake.review.cutting")} /> : null}
        {g.cutError ? (
          <StatusLine
            variant="error"
            message={preview(g.cutError) ? failureMessage(t, g.cutError) : t("intake.fail.cut")}
            action={isRetryable(g.cutError) ? retry(onRetryCut) : undefined}
            disabled={busy || g.cutting === true}
          />
        ) : null}
        {g.redrawCutError ? (
          <StatusLine
            variant="error"
            message={preview(g.redrawCutError) ? failureMessage(t, g.redrawCutError) : t("intake.fail.redrawCut")}
            action={isRetryable(g.redrawCutError) ? retry(onRetryRedrawCut) : undefined}
            disabled={busy || g.cutting === true}
          />
        ) : null}
        {g.syncError ? <StatusLine variant="error" message={t("intake.fail.sync")} action={retry(onRetrySync)} disabled={busy} /> : null}
        {g.enhanceError ? <StatusLine variant="error" message={failureMessage(t, g.enhanceError)} /> : null}
        {g.saveError ? (
          <StatusLine
            variant="error"
            message={saveMessage(t, g.saveError)}
            action={isRetryable(g.saveError) ? retry(onSave) : undefined}
            disabled={busy}
          />
        ) : null}
        {g.saved ? <StatusLine variant="ok" message={t("intake.review.saved")} /> : null}
        {g.wholePhoto ? <StatusLine variant="info" message={t("intake.fail.wholePhoto")} /> : null}
        {g.specError ? <StatusLine variant="info" message={t("intake.fail.spec")} /> : null}
        {g.correctionError ? <StatusLine variant="info" message={t("intake.fail.correction")} /> : null}
      </View>

      {d && !g.saved ? (
        <>
          <Row
            title={t("item.spec.type")}
            unsure={unsure.has(UNCERTAIN_KEY.subcategory)}
            values={SUBCATEGORIES}
            proposed={g.proposal?.tags.subcategory}
            selected={d.tags.subcategory}
            label={(v) => t(`item.subcategory.${v}`)}
            onPick={(v) => setTags({ subcategory: v, category: SUBCATEGORY_TO_CATEGORY[v] })}
          />
          <Row
            title={t("item.spec.color")}
            unsure={unsure.has(UNCERTAIN_KEY.color_name)}
            values={COLOR_NAMES}
            proposed={g.proposal?.tags.color_name}
            selected={d.tags.color_name}
            label={(v) => t(`wardrobe.color.${v}`)}
            // The proposal's measured hex stays on its own name; a different name takes the palette hex.
            swatch={(v) => (v === g.proposal?.tags.color_name ? g.proposal.tags.color_hex : COLOR_HEX[v])}
            onPick={(v) => setTags({ color_name: v, color_hex: v === g.proposal?.tags.color_name ? g.proposal.tags.color_hex : COLOR_HEX[v] })}
          />
          <Row
            title={t("item.spec.pattern")}
            unsure={unsure.has(UNCERTAIN_KEY.pattern)}
            values={PATTERNS}
            proposed={g.proposal?.tags.pattern}
            selected={d.tags.pattern}
            label={(v) => t(`item.pattern.${v}`)}
            onPick={(v) => setTags({ pattern: v })}
          />
          <Row
            title={t("item.spec.material")}
            unsure={unsure.has(UNCERTAIN_KEY.material)}
            values={MATERIALS}
            proposed={g.proposal?.tags.material}
            selected={d.tags.material}
            label={(v) => t(`item.material.${v}`)}
            onPick={(v) => setTags({ material: v })}
          />
          {hasSleeves(d.tags) ? (
            <Row
              title={t("item.spec.sleeve")}
              unsure={unsure.has("sleeve")}
              values={SLEEVE_CHOICES}
              proposed={g.proposal && hasSleeves(g.proposal.tags) && g.proposal.tags.sleeve !== "na" ? g.proposal.tags.sleeve : undefined}
              selected={d.tags.sleeve === "na" ? "short" : d.tags.sleeve}
              label={(v) => t(`item.sleeve.${v}`)}
              onPick={(v) => setTags({ sleeve: v })}
            />
          ) : null}
          {isBottom(d.tags) ? (
            <Row
              title={t("item.spec.leg")}
              unsure={unsure.has("subcategory")}
              values={LEG_CHOICES}
              proposed={g.proposal && isBottom(g.proposal.tags) ? legOf(g.proposal.tags) : undefined}
              selected={legOf(d.tags)}
              label={(v) => t(`item.leg.${v}`)}
              onPick={(v) => setTags({ subcategory: subcategoryForLeg(v, d.tags, g.proposal?.tags.subcategory) })}
            />
          ) : null}
          <Row
            title={t("item.spec.fit")}
            unsure={unsure.has(UNCERTAIN_KEY.fit)}
            values={FITS}
            proposed={g.proposal?.tags.fit}
            selected={d.tags.fit}
            label={(v) => t(`item.fit.${v}`)}
            onPick={(v) => setTags({ fit: v })}
          />
        </>
      ) : null}

      {!g.saved ? (
        <View className="mt-5 flex-row flex-wrap items-center" style={{ columnGap: 12, rowGap: 8 }}>
          {d ? (
            // Ink, not accent: the accent belongs to "choose photos", the screen's one main action.
            <Button variant="ink" label={g.saving ? t("intake.review.saving") : t("intake.review.save")} disabled={busy || g.saving === true} onPress={onSave} />
          ) : null}
          {d ? (
            <Button variant="outline" label={g.labelling ? t("intake.review.labelling") : t("intake.review.labelPhoto")} disabled={busy} onPress={onLabel} />
          ) : null}
          {g.issues.length > 0 && !g.enhanced ? <Button variant="outline" label={t("intake.retake")} disabled={busy} onPress={onRetake} /> : null}
          {d && !g.enhanced && !composing ? (
            <Button variant="text" label={g.enhancing ? t("intake.enhancing") : t("intake.enhance")} disabled={g.enhancing === true} onPress={() => setComposing(true)} />
          ) : null}
          <Button variant="text" label={t("intake.review.skip")} disabled={busy} onPress={onSkip} />
        </View>
      ) : null}

      {d && composing && !g.saved && !g.enhanced ? (
        <RedrawComposer
          tags={d.tags}
          name={d.name}
          brand={d.brand}
          description={description}
          issues={g.issues}
          itemId={g.itemId}
          onTagsChange={(patch) => setTags(patch)}
          // The proposal's measured hex stays on its own name; a different name takes the palette hex.
          colorHex={(v) => (v === g.proposal?.tags.color_name ? g.proposal.tags.color_hex : COLOR_HEX[v])}
          onSubmit={onEnhance}
          onCancel={() => setComposing(false)}
          busy={g.enhancing === true}
        />
      ) : null}
    </View>
  );
}
