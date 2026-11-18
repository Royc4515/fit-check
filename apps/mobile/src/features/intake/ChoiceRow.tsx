import { useTranslation } from "react-i18next";
import { Pressable, ScrollView, Text, View } from "react-native";
import { colors } from "../../theme/tokens";

/** One-tap choice chips shared by the intake review, the item editor and the redraw composer. */

export function Chip({ label, selected, swatch, onPress }: { label: string; selected: boolean; swatch?: string; onPress: () => void }) {
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

export function Row<T extends string>(props: {
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
