import {
  COLOR_NAMES,
  FITS,
  MATERIALS,
  PATTERNS,
  SUBCATEGORIES,
  SUBCATEGORY_TO_CATEGORY,
  type ItemTags,
  type TagProposal,
} from "@fit-check/schema";
import { Image } from "expo-image";
import { useTranslation } from "react-i18next";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { TextAction } from "../../components/TextAction";
import { colors } from "../../theme/tokens";
import { COLOR_HEX } from "./palette";

export type Draft = { name: string; brand: string | null; tags: ItemTags };

export type ReviewState = {
  url: string;
  issues: string[];
  enhanced?: boolean;
  enhancing?: boolean;
  enhanceError?: string;
  tagging?: boolean;
  tagError?: string;
  proposal?: TagProposal;
  draft?: Draft;
  labelling?: boolean;
  saving?: boolean;
  saved?: boolean;
  saveError?: boolean;
  skipped?: boolean;
};

type Props = {
  garment: ReviewState;
  busy: boolean;
  onChange: (draft: Draft) => void;
  onSave: () => void;
  onSkip: () => void;
  onEnhance: () => void;
  onLabel: () => void;
  onRetryTag: () => void;
  onRetake: () => void;
};

/** Which uncertain flag belongs to which row: the tagger reports "color", the row edits color_name. */
const UNCERTAIN_KEY = { subcategory: "subcategory", color_name: "color", pattern: "pattern", material: "material", fit: "fit" } as const;

function Chip({ label, selected, swatch, onPress }: { label: string; selected: boolean; swatch?: string; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      hitSlop={4}
      // Same chip as the wardrobe filters (DESIGN.md section 3): selected is an ink fill, never the accent.
      className={`flex-row items-center justify-center rounded border px-3 ${selected ? "border-ink bg-ink" : "border-hairline"}`}
      style={{ minHeight: 34, gap: 6 }}
    >
      {swatch ? <View style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: swatch, borderWidth: 1, borderColor: colors.hairline }} /> : null}
      <Text className={`font-body text-body-sm ${selected ? "text-ivory" : "text-ink-soft"}`}>{label}</Text>
    </Pressable>
  );
}

function Row<T extends string>(props: {
  title: string;
  unsure: boolean;
  values: readonly T[];
  /** The tagger's value, shown first so the row opens on it (rows scroll sideways; the rest are off-screen). */
  proposed: T | undefined;
  selected: T;
  label: (v: T) => string;
  swatch?: (v: T) => string;
  onPick: (v: T) => void;
}) {
  const { t } = useTranslation();
  return (
    <View className="mt-4">
      <Text className="font-body text-meta text-ink-faint">
        {props.title}
        {props.unsure ? <Text className="text-ink-soft">{` · ${t("intake.review.unsure")}`}</Text> : null}
      </Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingTop: 8 }}>
        {(props.proposed ? [props.proposed, ...props.values.filter((v) => v !== props.proposed)] : props.values).map((v) => (
          <Chip key={v} label={props.label(v)} selected={v === props.selected} swatch={props.swatch?.(v)} onPress={() => props.onPick(v)} />
        ))}
      </ScrollView>
    </View>
  );
}

/**
 * Review of one garment before it enters the wardrobe: the tagger's proposal as chips, one tap to change any field.
 * Fields the tagger was unsure of are marked, so the eye goes there first. Nothing is saved until "save".
 */
export function GarmentReview({ garment: g, busy, onChange, onSave, onSkip, onEnhance, onLabel, onRetryTag, onRetake }: Props) {
  const { t, i18n } = useTranslation();
  const d = g.draft;
  const unsure = new Set(g.proposal?.uncertain ?? []);
  const setTags = (patch: Partial<ItemTags>) => d && onChange({ ...d, tags: { ...d.tags, ...patch } });

  if (g.skipped) return null;

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
          {d && !g.enhanced ? (
            <TextAction label={g.enhancing ? t("intake.enhancing") : t("intake.enhance")} quiet disabled={g.enhancing} onPress={onEnhance} />
          ) : null}
          <TextAction label={t("intake.review.skip")} quiet disabled={busy} onPress={onSkip} />
        </View>
      ) : null}
    </View>
  );
}
