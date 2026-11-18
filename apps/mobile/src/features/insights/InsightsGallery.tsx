import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { Meta } from "../../components/ui";
import { summarizeSpend, type AiCallRow } from "../../data/insights";
import { layout } from "../../theme/tokens";
import { SpendSection, type SpendState } from "./SpendSection";

// Fixtures, not data: the design preview has no ai_calls, so these are the only way to see the spend section filled.
const POPULATED: AiCallRow[] = [
  ...Array.from({ length: 14 }, () => ({ provider: "google", task: "separate", cost_usd: 0.039 })),
  ...Array.from({ length: 4 }, () => ({ provider: "google", task: "separate", cost_usd: 0.161 })),
  ...Array.from({ length: 22 }, () => ({ provider: "anthropic", task: "tag", cost_usd: 0.0042 })),
  ...Array.from({ length: 9 }, () => ({ provider: "anthropic", task: "style", cost_usd: 0.021 })),
  ...Array.from({ length: 18 }, () => ({ provider: "modal", task: "cutout", cost_usd: 0.0011 })),
];
// Google at $6.90 of $8: past 80% of the cap, under it.
const NEAR: AiCallRow[] = [
  ...Array.from({ length: 30 }, () => ({ provider: "google", task: "separate", cost_usd: 0.23 })),
  ...Array.from({ length: 6 }, () => ({ provider: "anthropic", task: "tag", cost_usd: 0.004 })),
];

const STATES: { key: string; state: SpendState }[] = [
  { key: "populated", state: { kind: "ready", summary: summarizeSpend(POPULATED) } },
  { key: "near", state: { kind: "ready", summary: summarizeSpend(NEAR) } },
  { key: "empty", state: { kind: "ready", summary: summarizeSpend([]) } },
  { key: "preview", state: { kind: "unavailable" } },
];

/**
 * The design-system gallery's Insights block: the AI-spend section in each state, from fixtures. Section headings are
 * the section's own (level 2 inside the gallery), each under a meta label naming the state.
 */
export function InsightsGallery() {
  const { t } = useTranslation();
  return (
    <View style={{ maxWidth: layout.maxContentWidth, gap: 48 }}>
      {STATES.map(({ key, state }) => (
        <View key={key} testID={`gallery-spend-${key}`}>
          <Meta className="mb-2">{t(`ds.insights.${key}`)}</Meta>
          <SpendSection state={state} />
        </View>
      ))}
    </View>
  );
}
