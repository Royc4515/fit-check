import { useTranslation } from "react-i18next";
import { Text, View } from "react-native";
import { Display, Meta, Skeleton, StatusLine } from "../../components/ui";
import { capLevel, type SpendSummary } from "../../data/insights";
import { spoken } from "../item/a11y";
import { usd } from "./format";

export type SpendState =
  | { kind: "loading" }
  | { kind: "error"; message: string; retry: () => void }
  /** The design preview: its snapshot has no ai_calls, and the screen must not invent numbers. */
  | { kind: "unavailable" }
  | { kind: "ready"; summary: SpendSummary };

/** The bar: 8 high, radius 2 (DESIGN brief), ink fill on a hairline track. */
const BAR_H = 8;
/** Number columns of the task table, wide enough for "999" and "$99.99" in mono. */
const CALLS_W = 64;
const COST_W = 88;

/**
 * "AI cost this month" (DESIGN.md "שלב 2", "תובנות"): the month's total, one bar of Google spend against the monthly
 * cap with both numbers written, then cost by task. Near (80%+) or past the cap, a warn line with an icon says so in
 * words: never colour alone. Presentational: the gallery feeds it fixtures, the screen feeds it ai_calls.
 */
export function SpendSection({ state }: { state: SpendState }) {
  const { t } = useTranslation();
  return (
    <View>
      <Display>{t("insights.spend.title")}</Display>
      <View className="mt-6">
        {state.kind === "loading" ? (
          <View style={{ gap: 8 }}>
            <Skeleton height={34} width={120} radius="sm" />
            <Skeleton height={18} width={96} radius="sm" />
            <View className="mt-4">
              <Skeleton height={BAR_H} radius="sm" />
            </View>
          </View>
        ) : state.kind === "error" ? (
          <StatusLine variant="error" message={state.message} action={{ label: t("common.retry"), onPress: state.retry }} />
        ) : state.kind === "unavailable" ? (
          <Text className="font-body text-body text-ink-soft">{t("insights.spend.preview")}</Text>
        ) : state.summary.byTask.length === 0 ? (
          <Text className="font-body text-body text-ink-soft">{t("insights.spend.none")}</Text>
        ) : (
          <SpendContent summary={state.summary} />
        )}
      </View>
    </View>
  );
}

/**
 * A sentence with mono figures inside body text ("$1.20 of $8.00"): the translation decides the word order, the
 * figures keep the mono face. Markers are private-use characters no translation contains.
 */
function OfCap({ spent, cap }: { spent: string; cap: string }) {
  const { t } = useTranslation();
  const parts = t("insights.spend.ofCap", { spent: "", cap: "" }).split(/(|)/);
  return (
    <Text className="font-body text-body-sm text-ink-soft">
      {parts.map((p, n) =>
        p === "" || p === "" ? (
          <Text key={n} className="font-mono text-num-sm text-ink">
            {p === "" ? spent : cap}
          </Text>
        ) : (
          p
        )
      )}
    </Text>
  );
}

function SpendContent({ summary }: { summary: SpendSummary }) {
  const { t } = useTranslation();
  const level = capLevel(summary.googleUsd, summary.capUsd);
  const share = summary.capUsd > 0 ? Math.min(summary.googleUsd / summary.capUsd, 1) : 1;
  const spent = usd(summary.googleUsd);
  const cap = usd(summary.capUsd);
  return (
    <View>
      {/* items-start: a line of only figures takes LTR as its direction and would hug the left edge in Hebrew. */}
      <View className="items-start">
        <Text className="font-mono text-display text-ink">{usd(summary.totalUsd)}</Text>
        <Meta>{t("insights.spend.totalLabel")}</Meta>
      </View>

      <View className="mt-6">
        <Meta>{t("insights.spend.googleLabel")}</Meta>
        <View className="mt-2 flex-row items-center" style={{ gap: 12 }}>
          <View
            accessible
            role="progressbar"
            aria-label={spoken(t("insights.spend.barLabel", { spent, cap }))}
            aria-valuemin={0}
            aria-valuemax={Math.round(summary.capUsd * 100)}
            aria-valuenow={Math.round(Math.min(summary.googleUsd, summary.capUsd) * 100)}
            className="flex-1 flex-row overflow-hidden bg-hairline"
            style={{ height: BAR_H, borderRadius: 2 }}
            testID="spend-bar"
          >
            {/* Anchored at the start edge, so the bar fills in reading direction. */}
            <View className="bg-ink" style={{ width: `${share * 100}%`, height: BAR_H }} testID="spend-bar-fill" />
          </View>
          <OfCap spent={spent} cap={cap} />
        </View>
        {level !== "ok" ? (
          <View className="mt-2">
            <StatusLine
              variant="error"
              message={level === "over" ? t("insights.spend.over") : t("insights.spend.near", { left: usd(summary.capUsd - summary.googleUsd) })}
            />
          </View>
        ) : null}
      </View>

      <View className="mt-8">
        <View className="flex-row border-b border-hairline pb-2" style={{ gap: 12 }}>
          <View className="flex-1">
            <Meta>{t("insights.spend.colTask")}</Meta>
          </View>
          <View className="items-end" style={{ width: CALLS_W }}>
            <Meta>{t("insights.spend.colCalls")}</Meta>
          </View>
          <View className="items-end" style={{ width: COST_W }}>
            <Meta>{t("insights.spend.colCost")}</Meta>
          </View>
        </View>
        {summary.byTask.map((row) => (
          <View key={row.task} className="flex-row items-center border-b border-hairline py-3" style={{ gap: 12 }}>
            <View className="flex-1">
              <Text className="font-body text-body-sm text-ink" numberOfLines={1}>
                {t(`insights.spend.task.${row.task}`, { defaultValue: row.task })}
              </Text>
            </View>
            {/* items-end: the figures align to the end edge in either direction (a column's cross axis follows it). */}
            <View className="items-end" style={{ width: CALLS_W }}>
              <Text className="font-mono text-num text-ink">{`⁦${row.calls}⁩`}</Text>
            </View>
            <View className="items-end" style={{ width: COST_W }}>
              <Text className="font-mono text-num text-ink">{usd(row.usd)}</Text>
            </View>
          </View>
        ))}
      </View>
    </View>
  );
}
