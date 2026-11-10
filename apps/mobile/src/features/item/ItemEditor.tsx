import {
  COLOR_NAMES,
  FITS,
  MATERIALS,
  PATTERNS,
  SEASONS,
  SUBCATEGORIES,
  SUBCATEGORY_TO_CATEGORY,
  type Item,
  type ItemTags,
} from "@fit-check/schema";
import * as ImagePicker from "expo-image-picker";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { TextAction } from "../../components/TextAction";
import { describeForRedraw, enhanceCutout, preparePhoto, removeBackground, sourceCropPath, wholePhotoGarment } from "../../data/intake";
import { colors } from "../../theme/tokens";
import { Chip, Row } from "../intake/GarmentReview";
import { COLOR_HEX } from "../intake/palette";

export type ItemEdits = {
  save: (itemId: string, edit: { name: string; brand: string | null; tags: ItemTags }) => Promise<void>;
  setImage: (itemId: string, cutoutPath: string, thumbPath: string | null) => Promise<void>;
  archive: (itemId: string) => Promise<void>;
  userId: string;
};

type Busy = null | "saving" | "enhancing" | "replacing" | "removing";

/**
 * Editing an item already in the wardrobe (Roy, 2026-11-10): name and brand, every tag the engine uses, a paid AI
 * redraw from the original photo, a new photo, and removal. Tag edits are a draft until "save"; image changes and
 * removal apply at once because each is its own deliberate action.
 */
export function ItemEditor({ item, edits, onClose, onRemoved }: { item: Item; edits: ItemEdits; onClose: () => void; onRemoved: () => void }) {
  const { t, i18n } = useTranslation();
  const [name, setName] = useState(item.name);
  const [brand, setBrand] = useState(item.brand ?? "");
  const [tags, setTags] = useState<ItemTags>(item.tags);
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const patch = (p: Partial<ItemTags>) => setTags((cur) => ({ ...cur, ...p }));
  const align = { textAlign: i18n.language === "en" ? "left" : "right" } as const;

  const run = async (kind: Exclude<Busy, null>, work: () => Promise<void>) => {
    setBusy(kind);
    setError(null);
    try {
      await work();
    } catch (e) {
      console.error(`Item ${kind} failed`, e);
      setError(t(`item.edit.failed.${kind}`));
    } finally {
      setBusy(null);
    }
  };

  const save = () =>
    run("saving", async () => {
      await edits.save(item.id, { name: name.trim() || item.name, brand: brand.trim() || null, tags });
      onClose();
    });

  /** Redraws from the real crop (never from an earlier redraw), then removes the redraw's white background. */
  const enhance = () =>
    run("enhancing", async () => {
      const source = sourceCropPath(item.cutout_path);
      if (!source) throw new Error("no source photo");
      const drawn = await enhanceCutout(source, describeForRedraw(tags));
      if (!drawn.ok) throw new Error(drawn.reason);
      const cut = await removeBackground(drawn.path);
      await edits.setImage(item.id, cut.ok ? cut.path : drawn.path, cut.ok ? cut.thumb_path : null);
    });

  /** A new photo of the same garment: uploaded as a fresh crop, cut out when the worker is available. */
  const replacePhoto = async () => {
    const picked = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 1 });
    const asset = picked.canceled ? undefined : picked.assets[0];
    if (!asset) return;
    await run("replacing", async () => {
      const photo = await preparePhoto(asset.uri, asset.width, asset.height);
      const crop = await wholePhotoGarment(edits.userId, photo, `edit-${Date.now()}`);
      const cut = await removeBackground(crop.path);
      await edits.setImage(item.id, cut.ok ? cut.path : crop.path, cut.ok ? cut.thumb_path : null);
    });
  };

  const remove = () => {
    // Two taps: removal hides the item from the wardrobe and from every suggestion.
    if (!confirmRemove) return setConfirmRemove(true);
    void run("removing", async () => {
      await edits.archive(item.id);
      onRemoved();
    });
  };

  const toggleSeason = (s: (typeof SEASONS)[number]) => {
    const has = tags.seasons.includes(s);
    // At least one season: the schema requires it, and an item with none would never be suggested.
    if (has && tags.seasons.length === 1) return;
    patch({ seasons: has ? tags.seasons.filter((x) => x !== s) : SEASONS.filter((x) => x === s || tags.seasons.includes(x)) });
  };

  return (
    <View>
      <Text className="font-body text-meta text-ink-faint">{t("item.edit.name")}</Text>
      <TextInput
        value={name}
        onChangeText={setName}
        accessibilityLabel={t("item.edit.name")}
        className="mt-1 border-b border-hairline pb-1 font-body-semibold text-body text-ink"
        style={align}
      />
      <Text className="mt-4 font-body text-meta text-ink-faint">{t("item.edit.brand")}</Text>
      <TextInput
        value={brand}
        onChangeText={setBrand}
        accessibilityLabel={t("item.edit.brand")}
        className="mt-1 border-b border-hairline pb-1 font-body text-body text-ink"
        style={align}
      />

      <Row
        title={t("item.spec.type")}
        unsure={false}
        values={SUBCATEGORIES}
        proposed={item.tags.subcategory}
        selected={tags.subcategory}
        label={(v) => t(`item.subcategory.${v}`)}
        onPick={(v) => patch({ subcategory: v, category: SUBCATEGORY_TO_CATEGORY[v] })}
      />
      <Row
        title={t("item.spec.color")}
        unsure={false}
        values={COLOR_NAMES}
        proposed={item.tags.color_name}
        selected={tags.color_name}
        label={(v) => t(`wardrobe.color.${v}`)}
        swatch={(v) => (v === item.tags.color_name ? item.tags.color_hex : COLOR_HEX[v])}
        onPick={(v) => patch({ color_name: v, color_hex: v === item.tags.color_name ? item.tags.color_hex : COLOR_HEX[v] })}
      />
      <Row
        title={t("item.spec.pattern")}
        unsure={false}
        values={PATTERNS}
        proposed={item.tags.pattern}
        selected={tags.pattern}
        label={(v) => t(`item.pattern.${v}`)}
        onPick={(v) => patch({ pattern: v })}
      />
      <Row
        title={t("item.spec.material")}
        unsure={false}
        values={MATERIALS}
        proposed={item.tags.material}
        selected={tags.material}
        label={(v) => t(`item.material.${v}`)}
        onPick={(v) => patch({ material: v })}
      />
      <Row
        title={t("item.spec.fit")}
        unsure={false}
        values={FITS}
        proposed={item.tags.fit}
        selected={tags.fit}
        label={(v) => t(`item.fit.${v}`)}
        onPick={(v) => patch({ fit: v })}
      />

      <View className="mt-4">
        <Text className="font-body text-meta text-ink-faint">{t("item.spec.seasons")}</Text>
        <View className="flex-row flex-wrap" style={{ gap: 8, paddingTop: 8 }}>
          {SEASONS.map((s) => (
            <Chip key={s} label={t(`wardrobe.season.${s}`)} selected={tags.seasons.includes(s)} onPress={() => toggleSeason(s)} />
          ))}
        </View>
      </View>

      <View className="mt-4">
        <Text className="font-body text-meta text-ink-faint">{t("item.spec.formality")}</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, paddingTop: 8 }}>
          {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
            <Pressable
              key={n}
              onPress={() => patch({ formality: n })}
              accessibilityRole="button"
              accessibilityState={{ selected: tags.formality === n }}
              className={`items-center justify-center rounded border ${tags.formality === n ? "border-ink bg-ink" : "border-hairline"}`}
              style={{ width: 34, height: 34 }}
            >
              <Text className={`font-mono text-num ${tags.formality === n ? "text-ivory" : "text-ink-soft"}`}>{n}</Text>
            </Pressable>
          ))}
        </ScrollView>
      </View>

      <View className="mt-6 flex-row flex-wrap items-center" style={{ columnGap: 18, rowGap: 12 }}>
        <Pressable
          accessibilityRole="button"
          disabled={busy !== null}
          onPress={() => void save()}
          className="items-center justify-center rounded border border-ink px-5"
          style={{ height: 40, opacity: busy ? 0.4 : 1 }}
        >
          <Text className="font-body-semibold text-body-sm text-ink">{busy === "saving" ? t("item.edit.saving") : t("item.edit.save")}</Text>
        </Pressable>
        <TextAction label={t("item.edit.cancel")} quiet disabled={busy !== null} onPress={onClose} />
      </View>

      <View className="mt-10 border-t border-hairline pt-4" style={{ gap: 14 }}>
        <Text className="font-body text-meta text-ink-faint">{t("item.edit.image")}</Text>
        <View className="flex-row flex-wrap" style={{ columnGap: 18, rowGap: 12 }}>
          <TextAction label={busy === "replacing" ? t("item.edit.replacing") : t("item.edit.replacePhoto")} disabled={busy !== null} onPress={() => void replacePhoto()} />
          {sourceCropPath(item.cutout_path) ? (
            <TextAction label={busy === "enhancing" ? t("item.edit.enhancing") : t("intake.enhance")} quiet disabled={busy !== null} onPress={() => void enhance()} />
          ) : null}
        </View>
        <View className="mt-4 self-start">
          <Pressable onPress={remove} disabled={busy !== null} accessibilityRole="button" hitSlop={8}>
            <View className="border-b pb-1" style={{ borderColor: colors.accent }}>
              <Text className="font-body text-body-sm" style={{ color: colors.accent }}>
                {busy === "removing" ? t("item.edit.removing") : confirmRemove ? t("item.edit.removeConfirm") : t("item.edit.remove")}
              </Text>
            </View>
          </Pressable>
        </View>
      </View>

      {error ? <Text className="mt-4 font-body text-body-sm text-ink-soft">{error}</Text> : null}
    </View>
  );
}
