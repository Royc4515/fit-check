import type { DetectedGarment, RedrawSpec } from "@fit-check/schema";
import * as ImagePicker from "expo-image-picker";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ScrollView, Text, View, useWindowDimensions } from "react-native";
import { Button, Meta, ScreenHeader, Segmented, StatusLine } from "../../components/ui";
import { useWardrobe } from "../../data/WardrobeProvider";
import {
  cropGarment,
  detectPhoto,
  enhanceCutout,
  MIN_USEFUL_EDGE,
  preparePhoto,
  reasonOf,
  removeBackground,
  saveGarment,
  tagCutout,
  uploadLabel,
  uploadForClaude,
  uploadOriginal,
  wholePhotoGarment,
  type PreparedPhoto,
} from "../../data/intake";
import { setItemImage } from "../../data/items";
import { saveRedrawSpec } from "../../data/redraw";
import { layout } from "../../theme/tokens";
import { failureMessage, isRetryable } from "./failure";
import { GarmentReview, type Draft, type ReviewState } from "./GarmentReview";
import { JobCard, type JobStatus } from "./JobCard";
import { PendingQueue } from "./PendingQueue";
import { usePendingQueue } from "./usePendingQueue";

/** A garment from a photo: its crop, the tagger's proposal and the user's edits, and where it is in the flow. */
type Garment = DetectedGarment &
  ReviewState & {
    path: string;
    /** Set after a redraw; saved as the item's image instead of the crop. */
    enhancedPath?: string;
    /** Background-removed PNG and its thumbnail, when the worker is available. */
    cutoutPath?: string;
    thumbPath?: string;
    /** The redraw with its background removed (the redraw comes on white). */
    enhancedCutoutPath?: string;
    enhancedThumbPath?: string;
    /** The composer's spec of the redraw now shown, stored on the item so its next redraw starts there. */
    redrawSpec?: RedrawSpec;
    model?: string;
  };
type PickedAsset = { uri: string; width: number; height: number };
type Job = {
  id: string;
  preview: string;
  status: JobStatus;
  garments: Garment[];
  skipped: number;
  lowRes: boolean;
  reason?: string;
  /** Kept so a failed photo can be run again without asking the user to pick it twice. */
  asset: PickedAsset;
  index: number;
  single: boolean;
};
type Mode = "several" | "single";
/** The "send to Claude" run: idle, uploading, or finished with counts and the reason of the last failure. */
type ClaudeRun = null | "sending" | { sent: number; failed: number; reason?: string };

/** One photo at a time: predictable cost, and the user sees results arrive in the order they picked them. */
const MAX_PHOTOS_PER_BATCH = 10;
/** The wide layout: from here the controls keep a 720 column and review cards sit two to a row. */
const TWO_UP_MIN = 1200;
const COLUMN_WIDTH = 720;
const CARD_GAP = 32;

/** Picks photos from the library; empty when cancelled. */
async function pickImages(limit: number): Promise<PickedAsset[]> {
  const picked = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ["images"],
    allowsMultipleSelection: limit > 1,
    selectionLimit: limit,
    quality: 1,
  });
  return picked.canceled ? [] : picked.assets.slice(0, limit);
}

/** Meta is uppercase and tracked in English; the tips and hints are sentences. */
const SENTENCE = { textTransform: "none", letterSpacing: 0 } as const;

/**
 * "Add clothes" (stage C): photos in, confirmed wardrobe items out.
 * Per photo: upload, then detection and crops: every garment (several) or only the main one in front (single).
 * Per garment: Claude proposes type, colour, pattern, fabric and fit; the user corrects with one tap per field,
 * may add a care-label photo for the real composition, and saves. Corrections are stored and teach the tagger.
 * Status is a line with an icon, never a spinner (DESIGN.md section 1); every step that fails says so with its
 * reason, and offers a retry where one can change the answer.
 */
export function IntakeView({ userId }: { userId: string }) {
  const { t } = useTranslation();
  const wardrobe = useWardrobe();
  const { width } = useWindowDimensions();
  const desktop = width >= layout.desktopMin;
  const twoUp = width >= TWO_UP_MIN;
  const [jobs, setJobs] = useState<Job[]>([]);
  const [running, setRunning] = useState(false);
  const [mode, setMode] = useState<Mode>("single");
  // Callbacks run after awaits; reading jobs through a ref avoids acting on a stale render's copy.
  const jobsRef = useRef<Job[]>([]);
  useEffect(() => {
    jobsRef.current = jobs;
  }, [jobs]);

  const update = (id: string, patch: Partial<Job>) => setJobs((all) => all.map((j) => (j.id === id ? { ...j, ...patch } : j)));
  const updateGarment = (jobId: string, path: string, patch: Partial<Garment>) =>
    setJobs((all) =>
      all.map((j) => (j.id === jobId ? { ...j, garments: j.garments.map((g) => (g.path === path ? { ...g, ...patch } : g)) } : j))
    );
  const findGarment = (jobId: string, path: string) => jobsRef.current.find((j) => j.id === jobId)?.garments.find((g) => g.path === path);

  /** Asks the tagger for one garment; on success the proposal becomes the editable draft. */
  const tag = async (jobId: string, g: Pick<Garment, "path" | "description">, labelPath?: string) => {
    updateGarment(jobId, g.path, labelPath ? { labelling: true } : { tagging: true, tagError: undefined });
    const result = await tagCutout(g.path, g.description, labelPath);
    if (result.ok) {
      const draft: Draft = { name: result.proposal.name, brand: result.proposal.brand, tags: result.proposal.tags };
      // A label re-tag keeps the user's earlier answer to the duplicate question instead of asking again.
      const duplicate = labelPath ? undefined : (result.duplicate ?? null);
      updateGarment(jobId, g.path, {
        tagging: false,
        labelling: false,
        tagError: undefined,
        proposal: result.proposal,
        model: result.model,
        draft,
        ...(duplicate === undefined ? {} : { duplicate }),
      });
    } else {
      updateGarment(jobId, g.path, labelPath ? { labelling: false, tagError: result.reason } : { tagging: false, tagError: result.reason });
    }
  };

  /** The image an item should show: a redraw (cut out if possible) over the original's cutout, over the plain crop. */
  const imageOf = (g: Garment) => ({
    cutoutPath: g.enhancedCutoutPath ?? g.enhancedPath ?? g.cutoutPath ?? g.path,
    thumbPath: g.enhancedPath ? (g.enhancedThumbPath ?? null) : (g.thumbPath ?? null),
  });

  /**
   * don't touch / a cutout can land after "save" (Roy saves while it runs, 2026-11-10: ten items kept the uncut redraw
   * on white). When it does, the saved item (or the duplicate it replaced) gets the better image. A failure here is
   * shown on the garment: the item would otherwise keep the uncut image with nothing saying so.
   */
  const syncSaved = async (jobId: string, path: string) => {
    const g = findGarment(jobId, path);
    const itemId = g?.itemId ?? (g?.replaced ? g.duplicate?.item_id : undefined);
    if (!g || !itemId) return;
    const { cutoutPath, thumbPath } = imageOf(g);
    updateGarment(jobId, path, { syncing: true, syncError: false });
    try {
      await setItemImage(itemId, cutoutPath, thumbPath);
      updateGarment(jobId, path, { syncing: false });
      if (wardrobe.status === "ready") wardrobe.reload();
    } catch (error) {
      console.error("Late image update failed", error);
      updateGarment(jobId, path, { syncing: false, syncError: true });
    }
  };

  /** Background removal; on a failure the garment keeps its crop, and says so. */
  const cut = async (jobId: string, path: string) => {
    updateGarment(jobId, path, { cutting: true, cutError: undefined });
    const result = await removeBackground(path);
    // A redraw on screen has its own cutout step and its own line; the original's failure no longer matters then.
    const redrawn = findGarment(jobId, path)?.enhanced;
    if (!result.ok) return updateGarment(jobId, path, { cutting: false, ...(redrawn ? {} : { cutError: result.reason }) });
    // don't touch / Roy, 2026-11-10: a slow cutout of the original landed after he asked for the AI redraw and
    // replaced it on screen. If a redraw exists, keep the original's cutout as data only.
    updateGarment(jobId, path, { cutting: false, cutoutPath: result.path, thumbPath: result.thumb_path, ...(redrawn ? {} : { url: result.url }) });
    if (!redrawn) await syncSaved(jobId, path);
  };

  /** The redraw came back on white; cut it out so it sits on the same transparent ground as every other item. */
  const cutRedraw = async (jobId: string, path: string, redrawPath: string) => {
    updateGarment(jobId, path, { cutting: true, redrawCutError: undefined });
    const result = await removeBackground(redrawPath);
    updateGarment(
      jobId,
      path,
      result.ok
        ? { cutting: false, url: result.url, enhancedCutoutPath: result.path, enhancedThumbPath: result.thumb_path }
        : { cutting: false, redrawCutError: result.reason }
    );
    if (result.ok) await syncSaved(jobId, path);
  };

  /** Paid redraw, on request only, from the composer's spec (built on the confirmed tags, not detection's guess). */
  const enhance = async (jobId: string, path: string, spec: RedrawSpec) => {
    const g = findGarment(jobId, path);
    if (!g?.draft) return;
    updateGarment(jobId, path, { enhancing: true, enhanceError: undefined });
    const result = await enhanceCutout(path, spec);
    if (!result.ok) return updateGarment(jobId, path, { enhancing: false, enhanceError: result.reason });
    updateGarment(jobId, path, { redrawSpec: spec, specError: false });
    // Saved while the redraw ran: the item exists already, so the spec goes on it directly. The image is what
    // matters, so a failure only adds a quiet line.
    const savedId = findGarment(jobId, path)?.itemId;
    if (savedId) {
      void saveRedrawSpec(savedId, spec)
        .catch(() => false)
        .then((ok) => {
          if (!ok) updateGarment(jobId, path, { specError: true });
        });
    }
    if (result.transparent) {
      // Already cleared on the server (_shared/whitebg.ts): the redraw itself is the cutout.
      updateGarment(jobId, path, { enhancing: false, enhanced: true, url: result.url, enhancedPath: result.path });
      return syncSaved(jobId, path);
    }
    updateGarment(jobId, path, { enhancing: false, enhanced: true, url: result.url, enhancedPath: result.path });
    await cutRedraw(jobId, path, result.path);
  };

  /** A photo of the garment's care label: the composition on it settles wool versus cotton. */
  const addLabel = async (jobId: string, path: string) => {
    const [asset] = await pickImages(1);
    const g = findGarment(jobId, path);
    if (!asset || !g) return;
    updateGarment(jobId, path, { labelling: true, tagError: undefined });
    try {
      const photo = await preparePhoto(asset.uri, asset.width, asset.height);
      const labelPath = await uploadLabel(userId, photo, path);
      await tag(jobId, g, labelPath);
    } catch (error) {
      console.error("Label upload failed", error);
      updateGarment(jobId, path, { labelling: false, tagError: reasonOf(error) });
    }
  };

  const save = async (jobId: string, path: string) => {
    const g = findGarment(jobId, path);
    if (!g?.draft) return;
    updateGarment(jobId, path, { saving: true, saveError: undefined });
    try {
      const saved = await saveGarment({
        userId,
        ...imageOf(g),
        sourcePath: g.path,
        name: g.draft.name.trim() || g.proposal?.name || "Item",
        brand: g.draft.brand,
        tags: g.draft.tags,
        proposal: g.proposal ?? null,
        model: g.model ?? null,
        redrawSpec: g.enhancedPath ? g.redrawSpec : null,
      });
      updateGarment(jobId, path, { saving: false, saved: true, itemId: saved.id, correctionError: !saved.correctionSaved });
      if (wardrobe.status === "ready") wardrobe.reload();
    } catch (error) {
      console.error("Save failed", error);
      updateGarment(jobId, path, { saving: false, saveError: reasonOf(error) });
    }
  };

  /** "Same garment, but use this photo": the existing item gets the new image; nothing new is added. */
  const replaceExisting = async (jobId: string, path: string) => {
    const g = findGarment(jobId, path);
    if (!g?.duplicate) return;
    updateGarment(jobId, path, { saving: true, saveError: undefined });
    try {
      const { cutoutPath, thumbPath } = imageOf(g);
      await setItemImage(g.duplicate.item_id, cutoutPath, thumbPath);
      updateGarment(jobId, path, { saving: false, replaced: true });
      if (wardrobe.status === "ready") wardrobe.reload();
    } catch (error) {
      console.error("Replace image failed", error);
      updateGarment(jobId, path, { saving: false, saveError: reasonOf(error) });
    }
  };

  /**
   * Crops the garments of one uploaded photo. `single`: only the main garment, so clothes hanging behind it stay
   * out (Roy, 2026-11-09: a shirt shot in the closet came back twice with the black shirt behind it). If one-garment
   * detection fails, the whole frame is used rather than losing the photo, and the garment says so (`wholePhoto`).
   */
  const garmentsOf = async (photo: PreparedPhoto, path: string, single: boolean, jobId: string): Promise<{ garments: Garment[]; skipped: number } | null> => {
    const photoId = path.split("/").pop()!.replace(/\.[^.]+$/, "");
    update(jobId, { status: "separating" });
    const result = await detectPhoto(path, single);
    if (!result.ok || result.garments.length === 0) {
      if (single) {
        const crop = await wholePhotoGarment(userId, photo, photoId);
        return { garments: [{ box: [0, 0, 1000, 1000], category: "top", description: "", issues: [], wholePhoto: true, ...crop }], skipped: 0 };
      }
      update(jobId, { status: "failed", reason: result.ok ? "no_garments" : result.reason });
      return null;
    }
    update(jobId, { status: "cropping" });
    const garments: Garment[] = [];
    let skipped = 0;
    for (const [n, g] of (single ? result.garments.slice(0, 1) : result.garments).entries()) {
      try {
        garments.push({ ...g, ...(await cropGarment(userId, photo, photoId, n + 1, g)) });
      } catch (error) {
        console.error("Crop failed", error);
        skipped++;
      }
    }
    return { garments, skipped };
  };

  const [forClaude, setForClaude] = useState<ClaudeRun>(null);
  const queue = usePendingQueue(userId);
  // The photos that did not upload, so "try again" re-sends only those.
  const claudeFailedRef = useRef<PickedAsset[]>([]);

  /** Uploads photos for Claude one by one and folds the outcome into the run's counts. */
  const uploadBatchForClaude = async (assets: PickedAsset[], before: { sent: number }) => {
    setForClaude("sending");
    const failedAssets: PickedAsset[] = [];
    let sent = before.sent;
    let reason: string | undefined;
    for (const [i, asset] of assets.entries()) {
      try {
        const photo = await preparePhoto(asset.uri, asset.width, asset.height);
        await uploadForClaude(userId, photo, i);
        sent++;
      } catch (error) {
        console.error("Upload for Claude failed", error);
        failedAssets.push(asset);
        reason = reasonOf(error);
      }
    }
    claudeFailedRef.current = failedAssets;
    setForClaude({ sent, failed: failedAssets.length, reason });
    // The new photos appear in the queue without leaving the screen.
    queue.reload();
  };

  /** Parks photos for Claude (MCP intake_pending): upload only, no detection or tagging, so no paid call. */
  const sendToClaude = async () => {
    const assets = await pickImages(MAX_PHOTOS_PER_BATCH);
    if (assets.length === 0) return;
    await uploadBatchForClaude(assets, { sent: 0 });
  };

  const retryClaude = async () => {
    const assets = claudeFailedRef.current;
    if (assets.length === 0 || forClaude === null || forClaude === "sending") return;
    await uploadBatchForClaude(assets, { sent: forClaude.sent });
  };

  /** One photo through upload, separation and tagging. Never throws: a failure lands on the job. */
  const runJob = async (job: Job) => {
    try {
      update(job.id, { status: "uploading", reason: undefined });
      const photo = await preparePhoto(job.asset.uri, job.asset.width, job.asset.height);
      const path = await uploadOriginal(userId, photo, job.index);
      const found = await garmentsOf(photo, path, job.single, job.id);
      if (!found) return;
      if (found.garments.length === 0) {
        update(job.id, { status: "failed", reason: "upload", skipped: found.skipped });
        return;
      }
      update(job.id, { status: "done", garments: found.garments, skipped: found.skipped });
      // One at a time: the user starts reviewing the first garment while the rest are still being processed.
      // Tagging reads the crop, not the cutout: a transparent PNG loses the light the colour is judged against.
      for (const g of found.garments) await Promise.all([tag(job.id, g), cut(job.id, g.path)]);
    } catch (error) {
      console.error("Intake failed", error);
      update(job.id, { status: "failed", reason: reasonOf(error) });
    }
  };

  /** Runs each picked photo through upload, separation and tagging. `retake` is one photo of one garment. */
  const pick = async (retake = false) => {
    const single = retake || mode === "single";
    const assets = await pickImages(retake ? 1 : MAX_PHOTOS_PER_BATCH);
    if (assets.length === 0) return;
    const batch: Job[] = assets.map((a, i) => ({
      id: `${Date.now()}-${i}`,
      preview: a.uri,
      status: "waiting",
      garments: [],
      skipped: 0,
      lowRes: Math.max(a.width, a.height) > 0 && Math.max(a.width, a.height) < MIN_USEFUL_EDGE,
      asset: a,
      index: i,
      single,
    }));
    setJobs((all) => [...batch, ...all]);
    setRunning(true);
    for (const job of batch) await runJob(job);
    setRunning(false);
  };

  /** Runs a failed photo again from the start; its earlier result is cleared. */
  const retryJob = async (job: Job) => {
    update(job.id, { status: "waiting", garments: [], skipped: 0 });
    setRunning(true);
    await runJob(job);
    setRunning(false);
  };

  const contentWidth = twoUp ? layout.maxContentWidthWide : COLUMN_WIDTH;
  const cardWidth = twoUp ? (layout.maxContentWidthWide - 2 * layout.gutter - CARD_GAP) / 2 : undefined;
  const claudeLine = (() => {
    if (!forClaude || forClaude === "sending") return null;
    const failed = forClaude.failed > 0;
    const preview = forClaude.reason === "preview";
    return (
      <>
        {forClaude.sent > 0 ? <StatusLine variant="ok" message={t("intake.forClaude.done", { count: forClaude.sent })} /> : null}
        {failed ? (
          <StatusLine
            variant="error"
            message={
              preview
                ? failureMessage(t, "preview", "upload")
                : `${t("intake.forClaude.failed", { count: forClaude.failed })} ${failureMessage(t, forClaude.reason ?? "upload")}`
            }
            action={isRetryable(forClaude.reason ?? "upload") ? { label: t("intake.fail.retry"), onPress: () => void retryClaude() } : undefined}
          />
        ) : null}
      </>
    );
  })();

  return (
    <View className="flex-1 bg-ivory">
      <ScrollView
        contentContainerStyle={{
          width: "100%",
          maxWidth: contentWidth,
          alignSelf: "center",
          paddingHorizontal: layout.gutter,
          // The tab bar below already owns the bottom safe area.
          paddingBottom: 48,
        }}
      >
        <View style={{ width: "100%", maxWidth: COLUMN_WIDTH, alignSelf: "center" }}>
          <ScreenHeader title={t("intake.title")} safeArea={!desktop} />
          <Text className="mt-3 font-body text-body text-ink-soft">{t("intake.intro")}</Text>

          <View className="mt-6">
            <Segmented
              segments={[
                { key: "single", label: t("intake.mode.single") },
                { key: "several", label: t("intake.mode.several") },
              ]}
              value={mode}
              onChange={setMode}
              accessibilityLabel={t("intake.modeLabel")}
            />
          </View>
          <Text className="mt-3 font-body text-body-sm text-ink-soft">{t(`intake.tips.${mode}`)}</Text>

          <View className="mt-8">
            {/* The screen's one accent. */}
            <Button variant="primary" label={t("intake.pick")} fullWidth disabled={running} onPress={() => void pick(false)} />
          </View>
          <View className="mt-3">
            <Button
              variant="outline"
              label={forClaude === "sending" ? t("intake.forClaude.sending") : t("intake.forClaude.action")}
              fullWidth
              disabled={running || forClaude === "sending"}
              onPress={() => void sendToClaude()}
            />
          </View>
          <Meta style={SENTENCE} className="mt-2">
            {t("intake.forClaude.hint")}
          </Meta>
          {claudeLine}
          <PendingQueue state={queue.state} onRetry={queue.reload} now={queue.checkedAt} />
        </View>

        <View className="mt-12" style={{ gap: CARD_GAP }}>
          {jobs.map((job) => (
            <JobCard
              key={job.id}
              preview={job.preview}
              status={job.status}
              count={job.garments.length}
              reason={job.reason}
              lowRes={job.lowRes}
              skipped={job.skipped}
              onRetry={running ? undefined : () => void retryJob(job)}
            >
              <View className="mt-4 flex-row flex-wrap" style={{ columnGap: CARD_GAP, rowGap: 24 }}>
                {job.garments.map((g) => (
                  <View key={g.path} style={cardWidth ? { width: cardWidth } : { width: "100%" }}>
                    <GarmentReview
                      garment={g}
                      // A write for this garment is in flight: save, skip and the like wait for it.
                      busy={g.saving === true || g.syncing === true || g.labelling === true}
                      onChange={(draft) => updateGarment(job.id, g.path, { draft })}
                      onSave={() => void save(job.id, g.path)}
                      onSkip={() => updateGarment(job.id, g.path, { skipped: true })}
                      description={g.description}
                      onEnhance={(spec) => void enhance(job.id, g.path, spec)}
                      onLabel={() => void addLabel(job.id, g.path)}
                      onRetryTag={() => void tag(job.id, g)}
                      onRetake={() => void pick(true)}
                      onNotDuplicate={() => updateGarment(job.id, g.path, { duplicate: null })}
                      onReplaceExisting={() => void replaceExisting(job.id, g.path)}
                      onRetryCut={() => void cut(job.id, g.path)}
                      onRetryRedrawCut={() => {
                        const redrawPath = findGarment(job.id, g.path)?.enhancedPath;
                        if (redrawPath) void cutRedraw(job.id, g.path, redrawPath);
                      }}
                      onRetrySync={() => void syncSaved(job.id, g.path)}
                    />
                  </View>
                ))}
              </View>
            </JobCard>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}
