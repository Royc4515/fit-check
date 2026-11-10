import type { PairWeights } from "@fit-check/engine";
import { AVAILABILITIES, type Availability, type Item } from "@fit-check/schema";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, Text, View } from "react-native";
import { SpecTable } from "../../components/editorial/SpecTable";
import { ItemArt } from "../../components/item-art/ItemArt";
import { TextAction } from "../../components/TextAction";
import { ItemEditor, type ItemEdits } from "./ItemEditor";
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
/**
 * Where the item is: home, laundry, away (reserve duty), lent. Only `home` items are ever suggested, so this is the
 * laundry switch. The current state is ink with the underline; the others are faint, like an index.
 */
function AvailabilityControl({
  value,
  onChange,
}: {
  value: Availability;
  onChange?: (next: Availability) => void;
}) {
  const { t } = useTranslation();
  return (
    <View className="flex-row flex-wrap" style={{ columnGap: 16, rowGap: 8 }} accessibilityRole="radiogroup">
      {AVAILABILITIES.map((a) => {
        const selected = a === value;
        return (
          <Pressable
            key={a}
            accessibilityRole="radio"
            accessibilityState={{ selected, disabled: !onChange }}
            disabled={!onChange || selected}
            onPress={() => onChange?.(a)}
            hitSlop={8}
          >
            <View className={selected ? "border-b border-ink pb-1" : "pb-1"} style={selected ? undefined : { borderBottomWidth: 1, borderColor: "transparent" }}>
              <Text className={`font-body text-body ${selected ? "text-ink" : "text-ink-faint"}`}>{t(`wardrobe.availability.${a}`)}</Text>
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

export function ItemDetails({
  item,
  items,
  pairWeights,
  onAvailability,
  edits,
  onRemoved,
}: {
  item: Item;
  items: Item[];
  pairWeights: PairWeights;
  onAvailability?: (itemId: string, next: Availability, prev: Availability) => Promise<void>;
  /** Absent in read-only contexts (the design harness); the edit link is then hidden. */
  edits?: ItemEdits;
  onRemoved?: () => void;
}) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState(false);
  const [failed, setFailed] = useState(false);
  const changeAvailability = onAvailability
    ? (next: Availability) => {
        setFailed(false);
        onAvailability(item.id, next, item.availability).catch((error: unknown) => {
          console.error("Availability update failed", error);
          setFailed(true);
        });
      }
    : undefined;
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
    ...(tags.sleeve === "na" ? [] : [{ label: t("item.spec.sleeve"), value: t(`item.sleeve.${tags.sleeve}`) }]),
    // "Unknown" material carries no information (half the sheet import); the row is dropped instead.
    ...(tags.material === "unknown" ? [] : [{ label: t("item.spec.material"), value: t(`item.material.${tags.material}`) }]),
    { label: t("item.spec.seasons"), value: tags.seasons.map((s) => t(`wardrobe.season.${s}`)).join(", ") },
    { label: t("item.spec.formality"), value: <Num>{`${tags.formality}/10`}</Num> },
    { label: t("item.spec.range"), value: <Num>{`${tags.temp_min_c}–${tags.temp_max_c}°`}</Num> },
  ];

  if (editing && edits) {
    return <ItemEditor item={item} edits={edits} onClose={() => setEditing(false)} onRemoved={() => onRemoved?.()} />;
  }

  return (
    <View>
      <Text className="font-display text-display-xl text-ink">{item.name}</Text>
      {item.brand ? <Text className="mt-1 font-body text-body-sm text-ink-soft">{item.brand}</Text> : null}
      {edits ? (
        <View className="mt-3 self-start">
          <TextAction label={t("item.edit.open")} onPress={() => setEditing(true)} />
        </View>
      ) : null}

      <View className="mt-8">
        <Text className="font-body text-meta text-ink-faint">{t("item.where")}</Text>
        <View className="mt-2">
          <AvailabilityControl value={item.availability} onChange={changeAvailability} />
        </View>
        {item.availability !== "home" ? <Text className="mt-2 font-body text-body-sm text-ink-soft">{t("item.notSuggested")}</Text> : null}
        {failed ? <Text className="mt-2 font-body text-body-sm text-ink-soft">{t("item.availabilityFailed")}</Text> : null}
      </View>

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
                          {full ? <ItemArt tags={full.tags} cutoutPath={full.cutout_path} /> : null}
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
