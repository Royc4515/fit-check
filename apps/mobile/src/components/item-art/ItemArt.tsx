import type { ItemTags } from "@fit-check/schema";
import { Image } from "expo-image";
import { useId } from "react";
import { supabase } from "../../lib/supabase";
import Svg, { Circle, ClipPath, Defs, G, Line, Path, Pattern, Rect } from "react-native-svg";
import { SHAPES } from "./shapes";

/** Mixes a hex colour toward black by `amount` (0..1). Used for outlines so white shirts stay visible on ivory. */
export function shade(hex: string, amount: number): string {
  const n = parseInt(hex.slice(1), 16);
  const ch = (shift: number) => Math.round(((n >> shift) & 255) * (1 - amount));
  return `#${[16, 8, 0].map((s) => ch(s).toString(16).padStart(2, "0")).join("")}`;
}

/** Perceived lightness 0..1, to decide how strong the outline must be against the ivory ground. */
function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  return (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
}

type Props = {
  tags: ItemTags;
  /** Path in the public `cutouts` bucket. When set, the real photo is shown instead of the drawing. */
  cutoutPath?: string | null;
};

/** Public URL of a stored garment image (the cutouts bucket is public, served from the CDN). */
export function cutoutUrl(path: string): string {
  return supabase.storage.from("cutouts").getPublicUrl(path).data.publicUrl;
}

/**
 * The item drawn as a technical flat in its real colour and pattern. Fills its parent; the parent owns the frame
 * (ivory-deep ground, aspect ratio), exactly where a photo cutout will go later.
 */
export function ItemArt({ tags, cutoutPath }: Props) {
  if (cutoutPath) {
    // don't touch / Roy, 2026-11-09: items added from photos showed the drawing instead of the photo he saved.
    // The drawing is only for items that have no image (the sheet import).
    return <Image source={{ uri: cutoutUrl(cutoutPath) }} contentFit="contain" style={{ width: "100%", height: "100%" }} accessibilityIgnoresInvertColors />;
  }
  return <ItemDrawing tags={tags} />;
}

function ItemDrawing({ tags }: { tags: ItemTags }) {
  // don't touch / SVG ids are global on web: two shirts on one screen with the same pattern id would share (and
  // overwrite) each other's fill. useId gives a per-instance id; its colons are invalid inside url(#...).
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const shape = SHAPES[tags.subcategory];
  const fill = tags.color_hex;
  const light = luminance(fill) > 0.78;
  // Light garments need a firmer edge or they dissolve into the ivory ground; dark ones only a hint.
  const stroke = shade(fill, light ? 0.32 : 0.28);
  const accent = tags.secondary_color_hex ?? shade(fill, light ? 0.35 : 0.45);
  const patternId = `p${uid}`;
  const clipId = `c${uid}`;
  const hasPattern = tags.pattern !== "solid";

  return (
    <Svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="xMidYMid meet">
      <Defs>
        {/* The clip is referenced from inside the transformed group, so it is already in that group's space:
            giving it shape.fit too would apply the transform twice. */}
        <ClipPath id={clipId}>
          <Path d={shape.body} />
        </ClipPath>
        {hasPattern ? <FabricPattern id={patternId} pattern={tags.pattern} color={accent} /> : null}
      </Defs>
      <G transform={shape.fit}>
      <Path d={shape.body} fill={fill} />
      {hasPattern ? (
        <G clipPath={`url(#${clipId})`}>
          <Rect x="0" y="0" width="100" height="100" fill={`url(#${patternId})`} />
        </G>
      ) : null}
      {shape.overlays?.map((d) => <Path key={d} d={d} fill={fill} stroke={stroke} strokeWidth={1.1} />)}
      <Path d={shape.body} fill="none" stroke={stroke} strokeWidth={1.1} strokeLinejoin="round" />
      {shape.details?.map((d) => (
        <Path key={d} d={d} fill="none" stroke={stroke} strokeWidth={0.8} strokeLinecap="round" strokeLinejoin="round" opacity={0.85} />
      ))}
      {shape.dots?.map(([cx, cy]) => <Circle key={`${cx}-${cy}`} cx={cx} cy={cy} r={1.1} fill={stroke} />)}
      </G>
    </Svg>
  );
}

function FabricPattern({ id, pattern, color }: { id: string; pattern: ItemTags["pattern"]; color: string }) {
  switch (pattern) {
    case "stripes":
      return (
        <Pattern id={id} patternUnits="userSpaceOnUse" width="5" height="5">
          <Rect x="0" y="0" width="1.6" height="5" fill={color} opacity={0.55} />
        </Pattern>
      );
    case "check":
      return (
        <Pattern id={id} patternUnits="userSpaceOnUse" width="8" height="8">
          <Rect x="0" y="0" width="8" height="2.4" fill={color} opacity={0.4} />
          <Rect x="0" y="0" width="2.4" height="8" fill={color} opacity={0.4} />
        </Pattern>
      );
    case "print":
      return (
        <Pattern id={id} patternUnits="userSpaceOnUse" width="7" height="7">
          <Circle cx="2" cy="2" r="1" fill={color} opacity={0.6} />
          <Circle cx="5.5" cy="5.5" r="0.8" fill={color} opacity={0.45} />
        </Pattern>
      );
    case "denim":
      return (
        <Pattern id={id} patternUnits="userSpaceOnUse" width="3" height="3">
          <Line x1="0" y1="3" x2="3" y2="0" stroke={color} strokeWidth={0.35} opacity={0.35} />
        </Pattern>
      );
    case "melange":
      return (
        <Pattern id={id} patternUnits="userSpaceOnUse" width="4" height="4">
          <Circle cx="1" cy="1" r="0.45" fill={color} opacity={0.3} />
          <Circle cx="3" cy="2.6" r="0.35" fill="#FFFFFF" opacity={0.25} />
        </Pattern>
      );
    default:
      return null;
  }
}
