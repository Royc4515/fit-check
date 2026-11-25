import { Image } from "expo-image";
import { useWindowDimensions, View } from "react-native";
import cover from "../../../assets/cover/sign-in-cover.webp";

/** Width / height of the cut-out (786x970, the garments plus 16px of air on every side). */
const ASPECT = 786 / 970;

/**
 * The cover's height as a share of the window. At 0.37 the Google button stays on screen at 1366x768 and 1280x800 (the
 * rest of the screen takes about 490px); on a 390x844 phone the cap does not bind.
 */
const COVER_SHARE = 0.37;

/**
 * The sign-in cover's one object: a men's outfit laid flat, generated in Google Flow and cut out of its background, so
 * the garments float on the page itself with no frame and no ground (Roy, 2026-11-25: "something fake but
 * good-looking", then "with an empty background, floating"). Prompt, settings and the cut-out step:
 * design/cover/2026-11-25-sign-in-cover.md. Bundled with the app, so it needs no account and no network call, and
 * there is nothing to fail. Width follows the column and stops where the height cap binds, so the picture is never
 * cropped; its box keeps that size while it decodes, so nothing below moves.
 */
export function CoverPhoto() {
  const maxHeight = Math.round(useWindowDimensions().height * COVER_SHARE);
  return (
    // Decoration: the app name and tagline carry the screen's meaning, so the picture stays out of the accessibility
    // tree (aria-hidden for web, the other two props for iOS and Android).
    <View aria-hidden accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={{ alignItems: "center" }}>
      <View style={{ width: "100%", maxWidth: maxHeight * ASPECT, aspectRatio: ASPECT }}>
        <Image source={cover} contentFit="contain" style={{ width: "100%", height: "100%" }} />
      </View>
    </View>
  );
}
