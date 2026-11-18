import type { Item, TagProposal } from "@fit-check/schema";
import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { View, useWindowDimensions } from "react-native";
import { cutoutUrl } from "../../components/item-art/ItemArt";
import { Meta } from "../../components/ui";
import { layout } from "../../theme/tokens";
import { GarmentReview, type Draft, type ReviewState } from "./GarmentReview";
import { JobCard, type JobStatus } from "./JobCard";
import { PendingQueue } from "./PendingQueue";
import type { PendingQueueState } from "./usePendingQueue";

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

/** A fixed clock for the queue fixtures, so their captions ("3 hours ago", a date) never drift between runs. */
const QUEUE_NOW = Date.parse("2026-11-19T12:00:00Z");
/** Minutes before QUEUE_NOW, newest first: now, minutes, hours, and two older than a day (a date). */
const QUEUE_AGES = [0, 12, 3 * 60, 9 * 60, 23 * 60, 2 * 24 * 60, 9 * 24 * 60];
/** The queue sits in the screen's 720 column; the demo cell matches it. */
const QUEUE_COLUMN = 720 - 2 * 20;

/** Pending photos for the queue states, on the wardrobe's own images (a fixture never needs a real pending upload). */
function queueFixture(urls: readonly string[], n: number): PendingQueueState {
  const photos = QUEUE_AGES.slice(0, n).map((minutes, i) => ({
    path: `fixture/pending/${i}.jpg`,
    url: urls[i % Math.max(1, urls.length)] ?? "",
    uploadedAt: new Date(QUEUE_NOW - minutes * 60_000).toISOString(),
  }));
  return { status: "ready", photos };
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
  const queueUrls = items.flatMap((i) => (i.cutout_path ? [cutoutUrl(i.cutout_path)] : [])).slice(0, QUEUE_AGES.length);
  const queue: readonly { key: string; state: PendingQueueState }[] = [
    { key: "queueLoading", state: { status: "loading" } },
    { key: "queueOne", state: queueFixture(queueUrls, 1) },
    { key: "queueSeven", state: queueFixture(queueUrls, 7) },
    { key: "queueFailed", state: { status: "failed", reason: "network" } },
  ];
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
        <Meta>{t("ds.intake.queue")}</Meta>
        {/* The column count follows the window, as on the screen: 3 on a phone, 6 from 900. */}
        {queue.map((q) => (
          <View key={q.key} testID={`gallery-${q.key}`} style={{ maxWidth: QUEUE_COLUMN, width: "100%", gap: 8 }}>
            <Meta>{t(`ds.intake.${q.key}`)}</Meta>
            <PendingQueue state={q.state} onRetry={noop} now={QUEUE_NOW} spaced={false} />
          </View>
        ))}
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
