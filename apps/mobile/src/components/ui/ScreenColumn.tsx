import type { ReactNode } from "react";
import { View, useWindowDimensions } from "react-native";
import { layout } from "../../theme/tokens";

/** Reading width of a text-only desktop screen (profile, insights): wider reads as a form, not a page. */
const DESKTOP_COLUMN = 720;

/**
 * Content column for text screens. Below 900: the 560 centred column the phone layout uses. From 900: the same 1200
 * container as the TopNav (same 20 gutter), with the column pinned to its start edge, so the title lines up under the
 * brand mark instead of floating mid-page. The rest of the row stays empty on purpose (one object, a lot of air).
 */
export function ScreenColumn({ children }: { children: ReactNode }) {
  const desktop = useWindowDimensions().width >= layout.desktopMin;
  return (
    <View
      style={{
        flexGrow: 1,
        width: "100%",
        maxWidth: desktop ? layout.maxContentWidthWide : layout.maxContentWidth,
        alignSelf: "center",
        paddingHorizontal: layout.gutter,
      }}
    >
      <View style={{ flexGrow: 1, width: "100%", maxWidth: desktop ? DESKTOP_COLUMN : undefined }}>{children}</View>
    </View>
  );
}
