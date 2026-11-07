import type { Item } from "@fit-check/schema";
import { useTranslation } from "react-i18next";
import { Text, View } from "react-native";
import { getMockOutfitsWith } from "../today/mock";

/** Wraps numbers so they stay LTR inside Hebrew text (DESIGN.md section 2: numbers always LTR). */
const ltr = (s: string) => `⁦${s}⁩`;

/**
 * Tags as one running line, not chips (DESIGN.md section 3). Defaults carry no information, so `unknown`
 * material is left out instead of printing "Unknown".
 */
function tagLine(item: Item, t: (key: string) => string): string {
  const { tags } = item;
  return [
    t(`item.subcategory.${tags.subcategory}`),
    t(`wardrobe.color.${tags.color_name}`),
    t(`item.pattern.${tags.pattern}`),
    tags.material === "unknown" ? null : t(`item.material.${tags.material}`),
    tags.seasons.map((s) => t(`wardrobe.season.${s}`)).join(", "),
  ]
    .filter((part): part is string => Boolean(part))
    .join(" · ");
}

/** Everything under the hero: name, tags, numbers, and three outfits from the engine that contain this item. */
export function ItemDetails({ item }: { item: Item }) {
  const { t } = useTranslation();
  const outfits = getMockOutfitsWith(item.id, 3);

  return (
    <View>
      <Text className="font-display text-display-xl text-ink">{item.name}</Text>
      <Text className="mt-3 font-body text-body text-ink-soft">{tagLine(item, t)}</Text>
      <Text className="mt-3 font-mono text-num text-ink-soft">
        {t("item.formality", { value: ltr(String(item.tags.formality)) })}
        {" · "}
        {t("item.temperature", { range: ltr(`${item.tags.temp_min_c}–${item.tags.temp_max_c}°`) })}
      </Text>

      {outfits.length > 0 ? (
        <View className="mt-12">
          <Text className="font-body-semibold text-title text-ink">{t("item.goesWith")}</Text>
          <View className="mt-3">
            {outfits.map((outfit) => (
              <View key={outfit.outfit_id} className="border-b border-hairline py-3">
                <Text className="font-body text-body-sm text-ink">
                  {outfit.items
                    .filter((i) => i.id !== item.id)
                    .map((i) => i.name)
                    .join(" · ")}
                </Text>
              </View>
            ))}
          </View>
        </View>
      ) : null}
    </View>
  );
}
