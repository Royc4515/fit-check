import type { ShowcasePiece } from "@fit-check/schema";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useWindowDimensions, View } from "react-native";
import { StillLife } from "../../components/brand/StillLife";
import { FLAT_LAY_ASPECT, FlatLay, type FlatLayPiece } from "../../components/ui/FlatLay";
import { fetchShowcase } from "../../data/showcase";

/**
 * The cover's height as a share of the window. At 0.37 the Google button stays on screen at 1366x768 and 1280x800 (the
 * rest of the screen takes about 490px), and at 390x844 the cap does not bind, so phones keep the full 4:5 surface.
 */
const COVER_SHARE = 0.37;

type Cover = { kind: "loading" } | { kind: "look"; pieces: FlatLayPiece[] } | { kind: "drawing" };

/** The answer's garments as FlatLay pieces. No names or labels: the cover is decoration (see below). */
const toFlatLay = (pieces: readonly ShowcasePiece[]): FlatLayPiece[] =>
  pieces.map((p, i) => ({
    slot: p.slot,
    item: { id: p.item.id, name: "", tags: p.item.tags, cutout_path: p.item.cutout_path, thumb_path: p.item.thumb_path },
    index: String(i + 1).padStart(2, "0"),
    accessibilityLabel: "",
  }));

/**
 * The sign-in cover's one object: the owner's real look (Roy, 2026-11-25: "a real look of mine, not the fake one"),
 * laid out on Today's flat-lay without numbers, so the first screen shows what the app does with a real wardrobe.
 * The look comes from the public `showcase` function (his newest favourite that is still whole). Until it answers,
 * the same 4:5 space stays empty, so nothing below moves; the garments then fade in as on Today. When there is no
 * look or the call fails (offline, preview), the drawn still life stands in.
 */
export function CoverLook() {
  const { t } = useTranslation();
  const maxHeight = Math.round(useWindowDimensions().height * COVER_SHARE);
  const [cover, setCover] = useState<Cover>({ kind: "loading" });
  useEffect(() => {
    let live = true;
    void fetchShowcase().then((answer) => {
      if (live) setCover(answer.ok ? { kind: "look", pieces: toFlatLay(answer.pieces) } : { kind: "drawing" });
    });
    return () => {
      live = false;
    };
  }, []);

  if (cover.kind === "drawing") return <StillLife />;
  return (
    // Decoration: the app name and tagline carry the screen's meaning, so the garments stay out of the accessibility
    // tree (aria-hidden for web, the other two props for iOS and Android), as the drawing did.
    <View aria-hidden accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {cover.kind === "look" ? (
        <FlatLay pieces={cover.pieces} radius="md" numbered={false} maxHeight={maxHeight} accessibilityLabel={t("auth.tagline")} />
      ) : (
        <View style={{ width: "100%", aspectRatio: 1 / FLAT_LAY_ASPECT, maxHeight }} />
      )}
    </View>
  );
}
