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
import { Image } from "expo-image";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, Text, TextInput, View } from "react-native";
import { TextAction } from "../../components/TextAction";
import { cutoutUrl } from "../../components/item-art/ItemArt";
import { RedrawComposer } from "../redraw/RedrawComposer";
import { Row } from "./ChoiceRow";
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
  tagError?: string;
  proposal?: TagProposal;
  draft?: Draft;
  labelling?: boolean;
  saving?: boolean;
  saved?: boolean;
  /** Set on save, so a cutout that finishes later can still update the saved item. */
  itemId?: string;
  /** A wardrobe item the checker thinks is this same garment, until the user answers. */
  duplicate?: { item_id: string; name: string; image_path: string } | null;
  /** The user chose to put this photo on the existing item instead of adding a new one. */
  replaced?: boolean;
  saveError?: boolean;
  skipped?: boolean;
};

type Props = {
  garment: ReviewState;
  /** Detection's short description: the redraw composer reads collar, pockets and logos off it. */
  description?: string;
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
};

/** Which uncertain flag belongs to which row: the tagger reports "color", the row edits color_name. */
const UNCERTAIN_KEY = { subcategory: "subcategory", color_name: "color", pattern: "pattern", material: "material", fit: "fit" } as const;

/**
 * Review of one garment before it enters the wardrobe: the tagger's proposal as chips, one tap to change any field.
 * Fields the tagger was unsure of are marked, so the eye goes there first. Nothing is saved until "save".
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
}: Props) {
  const { t, i18n } = useTranslation();
  const [composing, setComposing] = useState(false);
  const d = g.draft;
  const unsure = new Set(g.proposal?.uncertain ?? []);
  const setTags = (patch: Partial<ItemTags>) => d && onChange({ ...d, tags: normalizeTags({ ...d.tags, ...patch }) });

  if (g.skipped) return null;

  if (g.replaced) {
    return (
      <View className="mt-6 flex-row items-center" style={{ gap: 14 }}>
        <View className="rounded-sm bg-ivory-deep" style={{ width: 56, aspectRatio: 3 / 4, overflow: "hidden" }}>
          <Image source={{ uri: g.url }} contentFit="contain" style={{ width: "100%", height: "100%" }} />
        </View>
        <Text className="font-body text-body-sm text-ink" style={{ flexShrink: 1 }}>{t("intake.duplicate.replaced", { name: g.duplicate?.name ?? "" })}</Text>
      </View>
    );
  }

  // Asked before anything else: reviewing tags for a garment that is already in the wardrobe is wasted effort.
  if (g.duplicate && !g.saved) {
    return (
      <View className="mt-6 border-s-2 border-ink ps-4">
        <Text className="font-body text-body text-ink">{t("intake.duplicate.title", { name: g.duplicate.name })}</Text>
        <View className="mt-3 flex-row" style={{ gap: 12 }}>
          {[g.url, cutoutUrl(g.duplicate.image_path)].map((uri, n) => (
            <View key={n} style={{ width: 96 }}>
              <View className="rounded-sm bg-ivory-deep" style={{ width: "100%", aspectRatio: 3 / 4, overflow: "hidden" }}>
                <Image source={{ uri }} contentFit="contain" style={{ width: "100%", height: "100%" }} />
              </View>
              <Text className="mt-1 font-body text-meta text-ink-faint">{n === 0 ? t("intake.duplicate.new") : t("intake.duplicate.existing")}</Text>
            </View>
          ))}
        </View>
        <View className="mt-4 flex-row flex-wrap items-center" style={{ columnGap: 18, rowGap: 12 }}>
          <Pressable
            accessibilityRole="button"
            disabled={busy || g.saving}
            onPress={onSkip}
            className="items-center justify-center rounded border border-ink px-5"
            style={{ height: 40 }}
          >
            <Text className="font-body-semibold text-body-sm text-ink">{t("intake.duplicate.same")}</Text>
          </Pressable>
          <TextAction label={g.saving ? t("intake.review.saving") : t("intake.duplicate.replace")} disabled={busy || g.saving} onPress={onReplaceExisting} />
          <TextAction label={t("intake.duplicate.different")} quiet disabled={busy} onPress={onNotDuplicate} />
        </View>
        {g.saveError ? <Text className="mt-2 font-body text-meta text-ink-soft">{t("intake.review.saveFailed")}</Text> : null}
      </View>
    );
  }

  return (
    <View className="mt-6">
      <View className="flex-row" style={{ gap: 14 }}>
        <View className="rounded-sm bg-ivory-deep" style={{ width: 112, aspectRatio: 3 / 4, overflow: "hidden" }}>
          <Image source={{ uri: g.url }} contentFit="contain" style={{ width: "100%", height: "100%" }} />
        </View>
        <View style={{ flex: 1 }}>
          {d ? (
            <>
              <TextInput
                value={d.name}
                onChangeText={(name) => onChange({ ...d, name })}
                accessibilityLabel={t("intake.review.name")}
                editable={!g.saved}
                className="border-b border-hairline pb-1 font-body-semibold text-body text-ink"
                style={{ textAlign: i18n.language === "en" ? "left" : "right" }}
              />
              {g.proposal?.label_composition ? (
                <Text className="mt-2 font-body text-meta text-ink-soft">{t("intake.review.label", { text: g.proposal.label_composition })}</Text>
              ) : null}
            </>
          ) : (
            <Text className="font-body text-body-sm text-ink-soft">
              {g.tagging ? t("intake.review.tagging") : g.tagError ? t(`intake.reason.${g.tagError}`, { defaultValue: t("intake.reason.unknown") }) : ""}
            </Text>
          )}
          {g.cutting ? <Text className="mt-2 font-body text-meta text-ink-faint">{t("intake.review.cutting")}</Text> : null}
          {g.issues.length > 0 && !g.enhanced ? (
            <Text className="mt-2 font-body text-meta text-ink-soft">{g.issues.map((i) => t(`intake.issue.${i}`)).join(" · ")}</Text>
          ) : null}
          {g.saved ? <Text className="mt-2 font-body text-body-sm text-ink">{t("intake.review.saved")}</Text> : null}
          {g.saveError ? <Text className="mt-2 font-body text-meta text-ink-soft">{t("intake.review.saveFailed")}</Text> : null}
          {g.enhanceError ? (
            <Text className="mt-2 font-body text-meta text-ink-faint">{t(`intake.reason.${g.enhanceError}`, { defaultValue: t("intake.reason.unknown") })}</Text>
          ) : null}
        </View>
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
        <View className="mt-5 flex-row flex-wrap items-center" style={{ columnGap: 18, rowGap: 12 }}>
          {d ? (
            <Pressable
              accessibilityRole="button"
              disabled={busy || g.saving}
              onPress={onSave}
              className="items-center justify-center rounded border border-ink px-5"
              style={{ height: 40, opacity: busy || g.saving ? 0.4 : 1 }}
            >
              <Text className="font-body-semibold text-body-sm text-ink">{g.saving ? t("intake.review.saving") : t("intake.review.save")}</Text>
            </Pressable>
          ) : null}
          {g.tagError ? <TextAction label={t("intake.review.retryTag")} disabled={busy} onPress={onRetryTag} /> : null}
          {d ? (
            <TextAction label={g.labelling ? t("intake.review.labelling") : t("intake.review.labelPhoto")} disabled={busy || g.labelling} onPress={onLabel} />
          ) : null}
          {g.issues.length > 0 && !g.enhanced ? <TextAction label={t("intake.retake")} disabled={busy} onPress={onRetake} /> : null}
          {d && !g.enhanced && !composing ? <TextAction label={t("intake.enhance")} quiet disabled={g.enhancing} onPress={() => setComposing(true)} /> : null}
          <TextAction label={t("intake.review.skip")} quiet disabled={busy} onPress={onSkip} />
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
