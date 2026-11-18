import type { ReactNode } from "react";
import { View, type LayoutChangeEvent } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors, layout, shadow } from "../../theme/tokens";

type Props = {
  /**
   * Phone: pinned to the bottom of the screen area, in the thumb zone, over the scrolling content. Desktop: false,
   * and the same content sits in the page flow (DESIGN.md: the primary button lives in the column, not floating).
   */
  floating: boolean;
  /**
   * Add the bottom safe area under the content. Off when something below already owns it (a tab bar under the
   * screen), or the bar would float a home-indicator's height too high.
   */
  safeArea?: boolean;
  /** The screen pads its scroll content by the bar's height, which changes with status lines. */
  onLayout?: (e: LayoutChangeEvent) => void;
  children: ReactNode;
};

const PAD_Y = 12;

/**
 * Floating action bar (DESIGN.md sections 2-3): ivory, `shadow.sheet` plus a top hairline, 20 gutter, 12 vertical
 * padding plus the safe area. The one other place besides an open sheet where a shadow is allowed. Content is the
 * screen's (primary button, icon buttons, status lines), stacked with 8 between rows.
 */
export function ActionBar({ floating, safeArea = true, onLayout, children }: Props) {
  const insets = useSafeAreaInsets();
  if (!floating) return <View style={{ gap: 8 }}>{children}</View>;
  return (
    <View
      onLayout={onLayout}
      style={[
        {
          position: "absolute",
          start: 0,
          end: 0,
          bottom: 0,
          backgroundColor: colors.ivory,
          borderTopWidth: 1,
          borderTopColor: colors.hairline,
          paddingHorizontal: layout.gutter,
          paddingTop: PAD_Y,
          paddingBottom: PAD_Y + (safeArea ? insets.bottom : 0),
          gap: 8,
        },
        shadow.sheet,
      ]}
    >
      {children}
    </View>
  );
}
