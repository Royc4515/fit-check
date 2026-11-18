import type { ReactNode } from "react";
import { Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Display } from "./Type";

type Props = {
  title: string;
  /** Item count etc., set in num-sm next to the title. A number, so it stays LTR inside Hebrew. */
  count?: number;
  /** Secondary screen actions (icon Buttons) at the end of the row. */
  actions?: ReactNode;
  /** Add the top safe area above the 32px. Off when the header sits under a TopNav (desktop). */
  safeArea?: boolean;
};

/**
 * Screen title row (DESIGN.md section 3 "שלד"): display-xl at the start, 32 below the safe area; secondary actions
 * as icons at the end of the same row. The screen's one big serif moment.
 */
export function ScreenHeader({ title, count, actions, safeArea = true }: Props) {
  const insets = useSafeAreaInsets();
  return (
    <View className="flex-row items-end" style={{ paddingTop: (safeArea ? insets.top : 0) + 32, gap: 8 }}>
      <View className="flex-1 flex-row items-baseline" style={{ gap: 8 }}>
        <Display size="display-xl" level={1} className="flex-shrink">
          {title}
        </Display>
        {count !== undefined ? (
          // Isolated LTR run: digits next to Hebrew must not be reordered by the bidi algorithm.
          <Text className="font-mono text-num-sm text-ink-soft">{`⁦${count}⁩`}</Text>
        ) : null}
      </View>
      {actions ? (
        <View className="flex-row items-center" style={{ gap: 4 }}>
          {actions}
        </View>
      ) : null}
    </View>
  );
}
