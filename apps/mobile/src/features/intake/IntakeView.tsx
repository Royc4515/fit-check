import type { ExtractedGarment } from "@fit-check/schema";
import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { TextLink } from "../../components/TextLink";
import { preparePhoto, separatePhoto, uploadOriginal } from "../../data/intake";
import { layout } from "../../theme/tokens";

type JobStatus = "waiting" | "uploading" | "separating" | "done" | "failed";
type Job = { id: string; preview: string; status: JobStatus; garments: ExtractedGarment[]; skipped: number; reason?: string };

/** One photo at a time: predictable cost, and the user sees results arrive in the order they picked them. */
const MAX_PHOTOS_PER_BATCH = 10;

/**
 * "Add clothes" (stage C, first slice): pick photos, each is uploaded and split into one clean image per garment.
 * Results are a preview only: saving to the wardrobe (tagging, confirmation) is the next slice, and the screen says so.
 * Status is text, never a spinner (DESIGN.md section 1).
 */
export function IntakeView({ userId }: { userId: string }) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const [jobs, setJobs] = useState<Job[]>([]);
  const [running, setRunning] = useState(false);

  const update = (id: string, patch: Partial<Job>) => setJobs((all) => all.map((j) => (j.id === id ? { ...j, ...patch } : j)));

  const pick = async () => {
    const picked = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsMultipleSelection: true,
      selectionLimit: MAX_PHOTOS_PER_BATCH,
      quality: 1,
    });
    if (picked.canceled || picked.assets.length === 0) return;
    const assets = picked.assets.slice(0, MAX_PHOTOS_PER_BATCH);
    const batch: Job[] = assets.map((a, i) => ({ id: `${Date.now()}-${i}`, preview: a.uri, status: "waiting", garments: [], skipped: 0 }));
    setJobs((all) => [...batch, ...all]);
    setRunning(true);
    for (const [i, asset] of assets.entries()) {
      const job = batch[i]!;
      try {
        update(job.id, { status: "uploading" });
        const prepared = await preparePhoto(asset.uri, asset.width, asset.height);
        const path = await uploadOriginal(userId, prepared, i);
        update(job.id, { status: "separating" });
        const result = await separatePhoto(path);
        if (result.ok) update(job.id, { status: "done", garments: result.garments, skipped: result.skipped });
        else update(job.id, { status: "failed", reason: result.reason });
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
        <Text className="mt-2 font-body text-body-sm text-ink-soft">{t("intake.tips")}</Text>
        <Text className="mt-2 font-body text-body-sm text-ink-faint">{t("intake.previewOnly")}</Text>

        <Pressable
          accessibilityRole="button"
          disabled={running}
          accessibilityState={{ disabled: running }}
          onPress={() => void pick()}
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
                <Text className="font-body text-body-sm text-ink-soft" style={{ flexShrink: 1 }}>
                  {statusText(job)}
                </Text>
              </View>
              {job.garments.length > 0 ? (
                <View className="mt-4 flex-row flex-wrap" style={{ gap: 12 }}>
                  {job.garments.map((g) => (
                    <View key={g.path} style={{ width: "30%" }}>
                      <View className="rounded-sm bg-ivory-deep" style={{ width: "100%", aspectRatio: 3 / 4, overflow: "hidden" }}>
                        <Image source={{ uri: g.url }} contentFit="contain" style={{ width: "100%", height: "100%" }} />
                      </View>
                      <Text className="mt-1 font-body text-meta text-ink-faint" numberOfLines={2}>
                        {t(`wardrobe.category.${g.category}`)}
                      </Text>
                    </View>
                  ))}
                </View>
              ) : null}
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
