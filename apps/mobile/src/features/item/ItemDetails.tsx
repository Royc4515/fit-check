import type { PairWeights } from "@fit-check/engine";
import type { Item } from "@fit-check/schema";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Text, View } from "react-native";
import { SpecTable } from "../../components/editorial/SpecTable";
import { ItemArt } from "../../components/item-art/ItemArt";
import { getOutfitsWith } from "../today/outfit";

/** Wraps numbers so they stay LTR inside Hebrew text (DESIGN.md section 2: numbers always LTR). */
const ltr = (s: string) => `⁦${s}⁩`;

/** A number in mono inside a spec cell. Kept apart from Hebrew words: Plex Mono has no Hebrew glyphs. */
function Num({ children }: { children: string }) {
  return <Text className="font-mono text-num text-ink">{ltr(children)}</Text>;
}

/**
 * Everything under the hero: the name, the tags as a spec sheet, and up to three engine outfits that contain this
 * item, each drawn as a small trio so "goes with" is something you see, not a list of names.
 */
export function ItemDetails({ item, items, pairWeights }: { item: Item; items: Item[]; pairWeights: PairWeights }) {
  const { t } = useTranslation();
  const outfits = useMemo(() => getOutfitsWith(items, pairWeights, item.id, 3), [items, pairWeights, item.id]);
  const byId = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  const { tags } = item;

  const rows = [
    { label: t("item.spec.type"), value: t(`item.subcategory.${tags.subcategory}`) },
    {
      label: t("item.spec.color"),
      value: (
        <View className="flex-row items-center" style={{ gap: 8 }}>
          <View className="border border-hairline" style={{ width: 14, height: 14, backgroundColor: tags.color_hex }} />
          <Text className="font-body text-body text-ink">{t(`wardrobe.color.${tags.color_name}`)}</Text>
        </View>
      ),
    },
    { label: t("item.spec.pattern"), value: t(`item.pattern.${tags.pattern}`) },
    // "Unknown" material carries no information (half the sheet import); the row is dropped instead.
    ...(tags.material === "unknown" ? [] : [{ label: t("item.spec.material"), value: t(`item.material.${tags.material}`) }]),
    { label: t("item.spec.seasons"), value: tags.seasons.map((s) => t(`wardrobe.season.${s}`)).join(", ") },
    { label: t("item.spec.formality"), value: <Num>{`${tags.formality}/10`}</Num> },
    { label: t("item.spec.range"), value: <Num>{`${tags.temp_min_c}–${tags.temp_max_c}°`}</Num> },
  ];

  return (
    <View>
      <Text className="font-display text-display-xl text-ink">{item.name}</Text>
      {item.brand ? <Text className="mt-1 font-body text-body-sm text-ink-soft">{item.brand}</Text> : null}

      <View className="mt-8">
        <SpecTable rows={rows} />
      </View>

      {outfits.length > 0 ? (
        <View className="mt-12">
          <Text className="font-display text-display text-ink">{t("item.goesWith")}</Text>
          <View className="mt-4" style={{ gap: 20 }}>
            {outfits.map((outfit, n) => {
              const others = outfit.items.filter((i) => i.id !== item.id);
              return (
                <View key={outfit.outfit_id} className="border-t border-hairline pt-3">
                  <View className="flex-row" style={{ gap: 8 }}>
                    <Text className="font-mono text-meta text-ink-faint" style={{ width: 20 }}>
                      {String(n + 1).padStart(2, "0")}
                    </Text>
                    {others.map((o) => {
                      const full = byId.get(o.id);
                      return (
                        <View key={o.id} className="rounded-sm bg-ivory-deep" style={{ width: 64, height: 80, padding: 8 }}>
                          {full ? <ItemArt tags={full.tags} /> : null}
                        </View>
                      );
                    })}
                  </View>
                  <Text className="mt-2 font-body text-meta text-ink-faint" numberOfLines={2}>
                    {others.map((o) => o.name).join(" · ")}
                  </Text>
                </View>
              );
            })}
          </View>
        </View>
      ) : null}
    </View>
  );
}
