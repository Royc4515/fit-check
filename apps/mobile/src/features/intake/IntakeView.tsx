import type { DetectedGarment } from "@fit-check/schema";
import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { TextLink } from "../../components/TextLink";
import { useWardrobe } from "../../data/WardrobeProvider";
import {
  cropGarment,
  describeForRedraw,
  detectPhoto,
  enhanceCutout,
  MIN_USEFUL_EDGE,
  preparePhoto,
  removeBackground,
  saveGarment,
  tagCutout,
  uploadLabel,
  uploadOriginal,
  wholePhotoGarment,
  type PreparedPhoto,
} from "../../data/intake";
import { setItemImage } from "../../data/items";
import { layout } from "../../theme/tokens";
import { GarmentReview, type Draft, type ReviewState } from "./GarmentReview";

type JobStatus = "waiting" | "uploading" | "separating" | "cropping" | "done" | "failed";
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
    model?: string;
  };
type Job = { id: string; preview: string; status: JobStatus; garments: Garment[]; skipped: number; lowRes: boolean; reason?: string };
type Mode = "several" | "single";

/** One photo at a time: predictable cost, and the user sees results arrive in the order they picked them. */
const MAX_PHOTOS_PER_BATCH = 10;

/** Picks photos from the library; empty when cancelled. */
async function pickImages(limit: number) {
  const picked = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ["images"],
    allowsMultipleSelection: limit > 1,
    selectionLimit: limit,
    quality: 1,
  });
  return picked.canceled ? [] : picked.assets.slice(0, limit);
}

function ModeChip({ value, mode, onPick }: { value: Mode; mode: Mode; onPick: (m: Mode) => void }) {
  const { t } = useTranslation();
  const selected = mode === value;
  return (
    <Pressable
      onPress={() => onPick(value)}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      className={`justify-center rounded border px-3 ${selected ? "border-ink bg-ink" : "border-hairline"}`}
      style={{ minHeight: 36 }}
    >
      <Text className={`font-body text-body-sm ${selected ? "text-ivory" : "text-ink-soft"}`}>{t(`intake.mode.${value}`)}</Text>
    </Pressable>
  );
}

/**
 * "Add clothes" (stage C): photos in, confirmed wardrobe items out.
 * Per photo: upload, then detection and crops: every garment (several) or only the main one in front (single).
 * Per garment: Claude proposes type, colour, pattern, fabric and fit; the user corrects with one tap per field,
 * may add a care-label photo for the real composition, and saves. Corrections are stored and teach the tagger.
 * Status is text, never a spinner (DESIGN.md section 1).
 */
export function IntakeView({ userId }: { userId: string }) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const wardrobe = useWardrobe();
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
        proposal: result.proposal,
        model: result.model,
        draft,
        ...(duplicate === undefined ? {} : { duplicate }),
      });
    } else {
      updateGarment(jobId, g.path, labelPath ? { labelling: false, tagError: result.reason } : { tagging: false, tagError: result.reason });
    }
  };

  /** Background removal; on any failure the garment simply keeps its crop. */
  const cut = async (jobId: string, path: string) => {
    updateGarment(jobId, path, { cutting: true });
    const result = await removeBackground(path);
    if (!result.ok) return updateGarment(jobId, path, { cutting: false });
    // don't touch / Roy, 2026-11-10: a slow cutout of the original landed after he asked for the AI redraw and
    // replaced it on screen. If a redraw exists, keep the original's cutout as data only.
    const redrawn = findGarment(jobId, path)?.enhanced;
    updateGarment(jobId, path, { cutting: false, cutoutPath: result.path, thumbPath: result.thumb_path, ...(redrawn ? {} : { url: result.url }) });
  };

  /** Paid redraw, on request only, described from the confirmed tags (not detection's guess). */
  const enhance = async (jobId: string, path: string) => {
    const g = findGarment(jobId, path);
    if (!g?.draft) return;
    updateGarment(jobId, path, { enhancing: true, enhanceError: undefined });
    const result = await enhanceCutout(path, describeForRedraw(g.draft.tags, g.draft.name));
    if (!result.ok) return updateGarment(jobId, path, { enhancing: false, enhanceError: result.reason });
    updateGarment(jobId, path, { enhancing: false, enhanced: true, url: result.url, enhancedPath: result.path, cutting: true });
    // The redraw comes on white; cut it out too so it sits on the same transparent ground as every other item.
    const cut = await removeBackground(result.path);
    updateGarment(
      jobId,
      path,
      cut.ok ? { cutting: false, url: cut.url, enhancedCutoutPath: cut.path, enhancedThumbPath: cut.thumb_path } : { cutting: false }
    );
  };

  /** A photo of the garment's care label: the composition on it settles wool versus cotton. */
  const addLabel = async (jobId: string, path: string) => {
    const [asset] = await pickImages(1);
    const g = findGarment(jobId, path);
    if (!asset || !g) return;
    try {
      const photo = await preparePhoto(asset.uri, asset.width, asset.height);
      const labelPath = await uploadLabel(userId, photo, path);
      await tag(jobId, g, labelPath);
    } catch (error) {
      console.error("Label upload failed", error);
      updateGarment(jobId, path, { labelling: false, tagError: "upload" });
    }
  };

  const save = async (jobId: string, path: string) => {
    const g = findGarment(jobId, path);
    if (!g?.draft) return;
    updateGarment(jobId, path, { saving: true, saveError: false });
    try {
      await saveGarment({
        userId,
        // The user's choice wins: a redraw (cut out if possible) over the original's cutout, over the plain crop.
        cutoutPath: g.enhancedCutoutPath ?? g.enhancedPath ?? g.cutoutPath ?? g.path,
        sourcePath: g.path,
        thumbPath: g.enhancedPath ? (g.enhancedThumbPath ?? null) : (g.thumbPath ?? null),
        name: g.draft.name.trim() || g.proposal?.name || "Item",
        brand: g.draft.brand,
        tags: g.draft.tags,
        proposal: g.proposal ?? null,
        model: g.model ?? null,
      });
      updateGarment(jobId, path, { saving: false, saved: true });
      if (wardrobe.status === "ready") wardrobe.reload();
    } catch (error) {
      console.error("Save failed", error);
      updateGarment(jobId, path, { saving: false, saveError: true });
    }
  };

  /** "Same garment, but use this photo": the existing item gets the new image; nothing new is added. */
  const replaceExisting = async (jobId: string, path: string) => {
    const g = findGarment(jobId, path);
    if (!g?.duplicate) return;
    updateGarment(jobId, path, { saving: true, saveError: false });
    try {
      const image = g.enhancedCutoutPath ?? g.enhancedPath ?? g.cutoutPath ?? g.path;
      const thumb = g.enhancedPath ? (g.enhancedThumbPath ?? null) : (g.thumbPath ?? null);
      await setItemImage(g.duplicate.item_id, image, thumb);
      updateGarment(jobId, path, { saving: false, replaced: true });
      if (wardrobe.status === "ready") wardrobe.reload();
    } catch (error) {
      console.error("Replace image failed", error);
      updateGarment(jobId, path, { saving: false, saveError: true });
    }
  };

  /**
   * Crops the garments of one uploaded photo. `single`: only the main garment, so clothes hanging behind it stay
   * out (Roy, 2026-11-09: a shirt shot in the closet came back twice with the black shirt behind it). If one-garment
   * detection fails, the whole frame is used rather than losing the photo.
   */
  const garmentsOf = async (photo: PreparedPhoto, path: string, single: boolean, jobId: string): Promise<{ garments: Garment[]; skipped: number } | null> => {
    const photoId = path.split("/").pop()!.replace(/\.[^.]+$/, "");
    update(jobId, { status: "separating" });
    const result = await detectPhoto(path, single);
    if (!result.ok || result.garments.length === 0) {
      if (single) {
        const crop = await wholePhotoGarment(userId, photo, photoId);
        return { garments: [{ box: [0, 0, 1000, 1000], category: "top", description: "", issues: [], ...crop }], skipped: 0 };
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
    }));
    setJobs((all) => [...batch, ...all]);
    setRunning(true);
    for (const [i, asset] of assets.entries()) {
      const job = batch[i]!;
      try {
        update(job.id, { status: "uploading" });
        const photo = await preparePhoto(asset.uri, asset.width, asset.height);
        const path = await uploadOriginal(userId, photo, i);
        const found = await garmentsOf(photo, path, single, job.id);
        if (!found) continue;
        if (found.garments.length === 0) {
          update(job.id, { status: "failed", reason: "upload" });
          continue;
        }
        update(job.id, { status: "done", garments: found.garments, skipped: found.skipped });
        // One at a time: the user starts reviewing the first garment while the rest are still being processed.
        // Tagging reads the crop, not the cutout: a transparent PNG loses the light the colour is judged against.
        for (const g of found.garments) await Promise.all([tag(job.id, g), cut(job.id, g.path)]);
      } catch (error) {
        console.error("Intake failed", error);
        update(job.id, { status: "failed", reason: "upload" });
      }
    }
    setRunning(false);
  };

  const statusText = (job: Job) => {
    if (job.status === "done") return t("intake.status.done", { count: job.garments.length, n: `⁦${job.garments.length}⁩` });
    if (job.status === "failed") return t(`intake.reason.${job.reason ?? "unknown"}`, { defaultValue: t("intake.reason.unknown") });
    return t(`intake.status.${job.status}`);
  };

  return (
    <View className="flex-1 bg-ivory">
      <ScrollView
        contentContainerStyle={{
          width: "100%",
          maxWidth: layout.maxContentWidth,
          alignSelf: "center",
          paddingTop: insets.top + 32,
          paddingBottom: insets.bottom + 64,
          paddingHorizontal: layout.gutter,
        }}
      >
        <View className="flex-row items-baseline justify-between">
          <Text className="font-display text-display-xl text-ink">{t("intake.title")}</Text>
          <TextLink href="/wardrobe" label={t("nav.wardrobe")} />
        </View>
        <Text className="mt-3 font-body text-body text-ink-soft">{t("intake.intro")}</Text>

        <View className="mt-6 flex-row" style={{ gap: 8 }}>
          <ModeChip value="single" mode={mode} onPick={setMode} />
          <ModeChip value="several" mode={mode} onPick={setMode} />
        </View>
        <Text className="mt-3 font-body text-body-sm text-ink-soft">{t(`intake.tips.${mode}`)}</Text>

        <Pressable
          accessibilityRole="button"
          disabled={running}
          accessibilityState={{ disabled: running }}
          onPress={() => void pick(false)}
          className="mt-8 items-center justify-center rounded bg-accent"
          style={{ height: 48, opacity: running ? 0.4 : 1 }}
        >
          <Text className="font-body-semibold text-body text-accent-ink">{t("intake.pick")}</Text>
        </Pressable>

        <View className="mt-10" style={{ gap: 28 }}>
          {jobs.map((job) => (
            <View key={job.id} className="border-t border-hairline pt-4">
              <View className="flex-row items-center" style={{ gap: 12 }}>
                <Image source={{ uri: job.preview }} contentFit="cover" style={{ width: 56, height: 70, borderRadius: 2 }} />
                <View style={{ flexShrink: 1 }}>
                  <Text className="font-body text-body-sm text-ink-soft">{statusText(job)}</Text>
                  {job.lowRes ? <Text className="mt-1 font-body text-meta text-ink-soft">{t("intake.lowRes")}</Text> : null}
                </View>
              </View>
              {job.garments.map((g) => (
                <GarmentReview
                  key={g.path}
                  garment={g}
                  busy={false}
                  onChange={(draft) => updateGarment(job.id, g.path, { draft })}
                  onSave={() => void save(job.id, g.path)}
                  onSkip={() => updateGarment(job.id, g.path, { skipped: true })}
                  onEnhance={() => void enhance(job.id, g.path)}
                  onLabel={() => void addLabel(job.id, g.path)}
                  onRetryTag={() => void tag(job.id, g)}
                  onRetake={() => void pick(true)}
                  onNotDuplicate={() => updateGarment(job.id, g.path, { duplicate: null })}
                  onReplaceExisting={() => void replaceExisting(job.id, g.path)}
                />
              ))}
              {job.skipped > 0 ? (
                <Text className="mt-2 font-body text-meta text-ink-faint">{t("intake.skipped", { n: `⁦${job.skipped}⁩` })}</Text>
              ) : null}
            </View>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}
