import type { Item, TagProposal } from "@fit-check/schema";
import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { View, useWindowDimensions } from "react-native";
import { cutoutUrl } from "../../components/item-art/ItemArt";
import { Meta } from "../../components/ui";
import { layout } from "../../theme/tokens";
import { GarmentReview, type Draft, type ReviewState } from "./GarmentReview";
import { JobCard, type JobStatus } from "./JobCard";

const noop = () => {};
/** One demo cell at the phone column's width, so the states look as they do on the screen. */
const COLUMN = 390 - 2 * 20;

function Cell({ label, children }: { label: string; children: ReactNode }) {
  return (
    <View style={{ maxWidth: COLUMN, width: "100%", gap: 8 }}>
      <Meta>{label}</Meta>
      {children}
    </View>
  );
}

function Review({ garment, draft, proposal, busy = false, onChange }: { garment: ReviewState; draft?: Draft; proposal?: TagProposal; busy?: boolean; onChange?: (d: Draft) => void }) {
  return (
    <GarmentReview
      garment={{ ...garment, draft, proposal }}
      busy={busy}
      onChange={onChange ?? noop}
      onSave={noop}
      onSkip={noop}
      onEnhance={noop}
      onLabel={noop}
      onRetryTag={noop}
      onRetake={noop}
      onNotDuplicate={noop}
      onReplaceExisting={noop}
      onRetryCut={noop}
      onRetryRedrawCut={noop}
      onRetrySync={noop}
    />
  );
}

const JOBS: readonly { key: string; status: JobStatus; reason?: string; lowRes?: boolean; skipped?: number; retry?: boolean }[] = [
  { key: "waiting", status: "waiting" },
  { key: "uploading", status: "uploading" },
  { key: "separating", status: "separating" },
  { key: "cropping", status: "cropping" },
  { key: "done", status: "done", lowRes: true, skipped: 1 },
  { key: "network", status: "failed", reason: "network", retry: true },
  { key: "http", status: "failed", reason: "http_502", retry: true },
  { key: "preview", status: "failed", reason: "preview" },
  { key: "limit", status: "failed", reason: "daily_limit" },
];

/**
 * The intake screen's states for the design gallery, rendered from fixtures built on the wardrobe's own items: every
 * job status, the review card, the duplicate card, and each of the failure lines the audit found. Gallery-only.
 */
export function IntakeGallery({ items }: { items: readonly Item[] }) {
  const { t } = useTranslation();
  const top = items.find((i) => i.cutout_path && i.tags.category === "top") ?? items.find((i) => i.cutout_path);
  const other = items.find((i) => i.cutout_path && i.id !== top?.id);
  const [draft, setDraft] = useState<Draft | null>(null);
  const wide = useWindowDimensions().width >= 1200;
  if (!top) return <Meta>{t("ds.intake.loading")}</Meta>;

  const url = top.cutout_path ? cutoutUrl(top.cutout_path) : "";
  const proposal: TagProposal = {
    name: top.name,
    brand: top.brand,
    tags: top.tags,
    label_composition: "60% כותנה, 40% פוליאסטר",
    uncertain: ["color", "material"],
  };
  const shown: Draft = draft ?? { name: top.name, brand: top.brand, tags: top.tags };
  const base: ReviewState = { url, issues: [] };
  const withDraft = { draft: shown, proposal };

  return (
    <View style={{ gap: 48 }}>
      <View style={{ gap: 24 }}>
        <Meta>{t("ds.intake.jobs")}</Meta>
        {JOBS.map((j) => (
          <Cell key={j.key} label={t(`ds.intake.job.${j.key}`)}>
            <JobCard
              preview={url}
              status={j.status}
              count={2}
              reason={j.reason}
              lowRes={j.lowRes ?? false}
              skipped={j.skipped ?? 0}
              onRetry={j.retry ? noop : undefined}
            />
          </Cell>
        ))}
      </View>

      <View style={{ gap: 32 }}>
        <Meta>{t("ds.intake.review")}</Meta>
        <Cell label={t("ds.intake.tagging")}>
          <Review garment={{ ...base, tagging: true, cutting: true }} />
        </Cell>
        <Cell label={t("ds.intake.proposed")}>
          <Review garment={{ ...base, issues: ["wrinkled"] }} {...withDraft} onChange={setDraft} />
        </Cell>
        <Cell label={t("ds.intake.tagError")}>
          <Review garment={{ ...base, tagError: "network" }} />
        </Cell>
        <Cell label={t("ds.intake.saveError")}>
          <Review garment={{ ...base, saveError: "http_500" }} {...withDraft} />
        </Cell>
        <Cell label={t("ds.intake.saveErrorPreview")}>
          <Review garment={{ ...base, saveError: "preview" }} {...withDraft} />
        </Cell>
        <Cell label={t("ds.intake.busy")}>
          <Review garment={{ ...base, saving: true }} {...withDraft} busy />
        </Cell>
        <Cell label={t("ds.intake.saved")}>
          <Review garment={{ ...base, saved: true }} {...withDraft} />
        </Cell>
      </View>

      <View style={{ gap: 32 }}>
        <Meta>{t("ds.intake.failures")}</Meta>
        <Cell label={t("ds.intake.f2")}>
          <Review garment={{ ...base, cutError: "not_configured" }} {...withDraft} />
        </Cell>
        <Cell label={t("ds.intake.f3")}>
          <Review garment={{ ...base, saved: true, syncError: true }} {...withDraft} />
        </Cell>
        <Cell label={t("ds.intake.f4")}>
          <Review garment={{ ...base, enhanced: true, redrawCutError: "network" }} {...withDraft} />
        </Cell>
        <Cell label={t("ds.intake.f5")}>
          <Review garment={{ ...base, saved: true, enhanced: true, specError: true }} {...withDraft} />
        </Cell>
        <Cell label={t("ds.intake.f6")}>
          <Review garment={{ ...base, wholePhoto: true }} {...withDraft} />
        </Cell>
        <Cell label={t("ds.intake.f7")}>
          <Review garment={{ ...base, saved: true, correctionError: true }} {...withDraft} />
        </Cell>
      </View>

      <View style={{ gap: 16 }}>
        <Meta>{t("ds.intake.twoUp")}</Meta>
        {/* Same widths as IntakeView at >= 1200: two cards and the gap fill the content column. */}
        <View className="flex-row flex-wrap" style={{ columnGap: 32, rowGap: 24 }}>
          {[0, 1].map((n) => (
            <View key={n} style={{ width: wide ? (layout.maxContentWidthWide - 2 * layout.gutter - 32) / 2 : "100%" }}>
              <Review garment={n === 0 ? base : { ...base, tagError: "network" }} {...(n === 0 ? withDraft : {})} />
            </View>
          ))}
        </View>
      </View>

      <View style={{ gap: 32 }}>
        <Meta>{t("ds.intake.duplicate")}</Meta>
        <Cell label={t("ds.intake.duplicateAsk")}>
          <Review garment={{ ...base, duplicate: { item_id: "x", name: other?.name ?? top.name, image_path: other?.cutout_path ?? top.cutout_path ?? "" } }} {...withDraft} />
        </Cell>
        <Cell label={t("ds.intake.duplicateFailed")}>
          <Review
            garment={{ ...base, saveError: "network", duplicate: { item_id: "x", name: other?.name ?? top.name, image_path: other?.cutout_path ?? top.cutout_path ?? "" } }}
            {...withDraft}
          />
        </Cell>
        <Cell label={t("ds.intake.replaced")}>
          <Review garment={{ ...base, replaced: true, duplicate: { item_id: "x", name: other?.name ?? top.name, image_path: "" } }} {...withDraft} />
        </Cell>
      </View>
    </View>
  );
}
