import { Image } from "expo-image";
import { useWindowDimensions, View } from "react-native";
import { colors } from "../../theme/tokens";
import cover from "../../../assets/cover/sign-in-cover.jpg";

/** Width / height of the photo: Google Flow offers 3:4, not the flat-lay's 4:5, and the photo is shown uncropped. */
const ASPECT = 3 / 4;

/**
 * The cover's height as a share of the window. At 0.37 the Google button stays on screen at 1366x768 and 1280x800 (the
 * rest of the screen takes about 490px); on a 390x844 phone the cap does not bind.
 */
const COVER_SHARE = 0.37;

/**
 * The sign-in cover's one object: a still life of a men's outfit generated in Google Flow (Roy, 2026-11-25:
 * "something fake but good-looking"; prompt and settings in design/cover/2026-11-25-sign-in-cover.md). Bundled with
 * the app, so it needs no account and no network call, and there is nothing to fail. Width follows the column and
 * stops where the height cap binds, so the photo is never cropped. Until it decodes, its box shows the tile ground in
 * its exact size, so nothing below moves.
 */
export function CoverPhoto() {
  const maxHeight = Math.round(useWindowDimensions().height * COVER_SHARE);
  return (
    // Decoration: the app name and tagline carry the screen's meaning, so the photo stays out of the accessibility
    // tree (aria-hidden for web, the other two props for iOS and Android).
    <View aria-hidden accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={{ alignItems: "center" }}>
      <View
        className="rounded-md"
        style={{ width: "100%", maxWidth: maxHeight * ASPECT, aspectRatio: ASPECT, overflow: "hidden", backgroundColor: colors["tile-deep"] }}
      >
        <Image source={cover} contentFit="cover" style={{ width: "100%", height: "100%" }} />
      </View>
    </View>
  );
}
