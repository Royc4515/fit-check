import { Text, View } from "react-native";
import { useRtl } from "./interaction";
import { Meta } from "./Type";

/** The bar: 8 high, radius 2, ink fill on a hairline track (the same bar as Insights' spend line, DESIGN brief). */
const BAR_H = 8;

/** Numbers stay LTR inside Hebrew text (DESIGN.md section 2). */
const ltr = (s: string) => `⁦${s}⁩`;

type Props = {
  /** What is measured, in `meta` above the bar. */
  label: string;
  /** Share used, 0-100; null when unknown (the bar stays empty and no number is shown, never a fake 0). */
  percent: number | null;
  /** The figures in words under the bar ("$0.12 of $0.50"); the translation decides the order. */
  detail?: string;
  /** Spoken description of the whole meter, e.g. "AI calls: 24% of this month's allowance". */
  accessibilityLabel: string;
};

/**
 * A usage meter: label, a thin bar that fills in reading direction, the percent in mono at the end, and the figures
 * under it. Presentational: a near or full meter is said in words by the screen (a StatusLine), never by colour alone.
 */
export function Meter({ label, percent, detail, accessibilityLabel }: Props) {
  const share = percent === null ? 0 : Math.min(Math.max(percent, 0), 100) / 100;
  // don't touch / explicit direction: react-native-web gives text dir="auto", so a Hebrew line that opens with a Latin
  // word ("AI: ...", "Gemini: ...") was laid out left to right, with its colon and figures on the wrong side.
  const direction = { writingDirection: useRtl() ? "rtl" : "ltr" } as const;
  return (
    <View style={{ gap: 8 }}>
      <View className="flex-row items-baseline justify-between" style={{ gap: 12 }}>
        {/* A sentence, not a heading: no English uppercase from the Meta default. */}
        <Meta style={{ ...direction, textTransform: "none" }}>{label}</Meta>
        {percent !== null ? <Text className="font-mono text-num-sm text-ink">{ltr(`${Math.round(percent)}%`)}</Text> : null}
      </View>
      <View
        accessible
        role="progressbar"
        aria-label={accessibilityLabel}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent === null ? undefined : Math.round(percent)}
        className="flex-row overflow-hidden bg-hairline"
        style={{ height: BAR_H, borderRadius: 2 }}
      >
        {/* Anchored at the start edge, so the bar fills in reading direction. */}
        <View className="bg-ink" style={{ width: `${share * 100}%`, height: BAR_H }} />
      </View>
      {detail ? (
        <Text className="font-body text-body-sm text-ink-soft" style={direction}>
          {detail}
        </Text>
      ) : null}
    </View>
  );
}
