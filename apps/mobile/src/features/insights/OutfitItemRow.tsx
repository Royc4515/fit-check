import { Pressable, Text, View } from "react-native";
import { Icon } from "../../components/ui";
import { focusRingProps } from "../../components/ui/interaction";
import { textDirection } from "../../components/ui/textDirection";
import { layoutRtl } from "../../i18n";
import { colors, layout } from "../../theme/tokens";

type Props = {
  /** The garment's type ("חולצה", "Shirt"), in the UI language. */
  type: string;
  /** The garment's own name; often Latin ("Carhartt WIP Detroit Jacket") even in the Hebrew UI. */
  name: string;
  onPress: () => void;
};

/**
 * One piece in an outfit's sheet: its type, then its name, as two texts side by side on the row's hairline (the look
 * of `ListRow`, which only has one label).
 *
 * Why two texts: as one string "חולצה · Carhartt WIP Detroit Jacket" has a single writing direction, and giving it a
 * left-to-right one (so a long Latin name truncates at its end, not its start) drew the Hebrew type on the wrong
 * side. Each text now takes its own direction from its own script, the type sits at the row's start edge, and the
 * name follows it, truncating at its end when it is long.
 */
export function OutfitItemRow({ type, name, onPress }: Props) {
  const fallback = layoutRtl() ? "rtl" : "ltr";
  return (
    <Pressable
      {...focusRingProps}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${type}, ${name}`}
      style={({ pressed }) => ({ backgroundColor: pressed ? colors["ivory-deep"] : undefined })}
    >
      <View className="flex-row items-center border-b border-hairline py-3" style={{ minHeight: layout.hit, gap: 12 }}>
        {/* Never shrinks: the name gives way first. */}
        <Text className="font-body text-body text-ink-soft" numberOfLines={1} style={{ writingDirection: textDirection(type, fallback), flexShrink: 0 }}>
          {type}
        </Text>
        {/* A start-aligned box, not textAlign, so a Latin name still hugs the type next to it (as ListRow does). */}
        <View className="flex-1" style={{ alignItems: "flex-start" }}>
          <Text className="font-body text-body text-ink" numberOfLines={1} style={{ writingDirection: textDirection(name, fallback), maxWidth: "100%" }}>
            {name}
          </Text>
        </View>
        <Icon name="chevron" mirrorInRtl />
      </View>
    </Pressable>
  );
}
