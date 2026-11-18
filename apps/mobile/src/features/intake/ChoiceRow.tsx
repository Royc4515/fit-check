import { useTranslation } from "react-i18next";
import { ScrollView, View } from "react-native";
import { Chip as UiChip, Icon, Meta } from "../../components/ui";

/** One-tap choice chips shared by the intake review, the item editor and the redraw composer. */

/** The library chip under the name this file has always exported, so the item editor keeps its import. */
export function Chip({ label, selected, swatch, onPress }: { label: string; selected: boolean; swatch?: string; onPress: () => void }) {
  return <UiChip label={label} selected={selected} swatch={swatch} onPress={onPress} />;
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
      <View className="flex-row items-center" style={{ gap: 4 }}>
        <Meta tone="text-ink-soft">{props.title}</Meta>
        {props.unsure ? (
          // A glyph and words, not a colour: the "worth checking" marker must survive greyscale.
          <View className="flex-row items-center" style={{ gap: 4 }}>
            <Icon name="info" color="ink-soft" />
            <Meta tone="text-ink-soft">{t("intake.review.unsure")}</Meta>
          </View>
        ) : null}
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingTop: 8 }}>
        {(props.proposed ? [props.proposed, ...props.values.filter((v) => v !== props.proposed)] : props.values).map((v) => (
          <UiChip key={v} label={props.label(v)} selected={v === props.selected} swatch={props.swatch?.(v)} onPress={() => props.onPick(v)} />
        ))}
      </ScrollView>
    </View>
  );
}
