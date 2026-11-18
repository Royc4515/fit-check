import type { Slot } from "@fit-check/schema";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Platform, Text, View } from "react-native";
import { Button, Display, EmptyState, FlatLay, flatLayTone, Meta, Skeleton, StatusLine, type FlatLayPiece } from "../../components/ui";
import type { WearSummary } from "../../data/insights";
import { spoken } from "../item/a11y";
import { registerOrigin } from "../item/transition";
import { longDate, ltr, shortDate, weekday } from "./format";

/** Outfits listed before "show more" (brief: up to 10). */
const FIRST_PAGE = 10;
/** Width of an outfit's small flat-lay: two and a bit garments' worth, readable without crowding the date. */
const OUTFIT_W = 120;
/** Gap between the strip's day squares (spacing scale). */
const DAY_GAP = 4;
/** Height of the big mono numbers (display line). */
const NUMBER_H = 34;

export type WearsState =
  | { kind: "loading" }
  | { kind: "error"; message: string; retry: () => void }
  | { kind: "ready"; summary: WearSummary };

/** The origin scope of one listed outfit's garments, for the item screen's shared-element flight. */
export const insightsScope = (wearId: string) => `insights:${wearId}`;

type Props = {
  state: WearsState;
  /** A garment was pressed: open its item, flying from that garment. */
  onOpenItem: (scope: string, itemId: string) => void;
  /** The empty state's one action (to Today, where wears are logged). */
  onEmptyAction: () => void;
};

/**
 * "Wears, last 30 days" (DESIGN.md "שלב 2", "תובנות"): three numbers, a 30-day strip, the recent outfits. No colour
 * beyond ink and hairline; a worn day is a filled square, an unworn one an outline, so the state is a shape too.
 */
export function WearsSection({ state, onOpenItem, onEmptyAction }: Props) {
  const { t } = useTranslation();
  return (
    <View>
      <Display>{t("insights.wears.title")}</Display>
      <View className="mt-6">
        {state.kind === "loading" ? (
          <WearsSkeleton />
        ) : state.kind === "error" ? (
          <StatusLine variant="error" message={state.message} action={{ label: t("common.retry"), onPress: state.retry }} />
        ) : state.summary.outfits.length === 0 ? (
          <EmptyState title={t("insights.wears.empty.title")} body={t("insights.wears.empty.body")} level={3} action={{ label: t("insights.wears.empty.action"), onPress: onEmptyAction }} />
        ) : (
          <WearsContent summary={state.summary} onOpenItem={onOpenItem} />
        )}
      </View>
    </View>
  );
}

function WearsContent({ summary, onOpenItem }: { summary: WearSummary; onOpenItem: Props["onOpenItem"] }) {
  const { t, i18n } = useTranslation();
  const locale = i18n.language === "en" ? "en" : "he";
  const [all, setAll] = useState(false);
  const shown = all ? summary.outfits : summary.outfits.slice(0, FIRST_PAGE);
  return (
    <View>
      <View className="flex-row" style={{ gap: 16 }}>
        <Stat value={ltr(summary.daysWorn)} label={t("insights.wears.daysWorn")} />
        <Stat value={ltr(summary.distinctItems)} label={t("insights.wears.distinctItems")} />
        <View className="flex-1 items-start">
          {/* A name, not a figure: body type, kept to the numbers' height so the three labels line up. */}
          <View className="items-start" style={{ minHeight: NUMBER_H, justifyContent: "flex-end" }}>
            <Text className="font-body text-body text-ink" numberOfLines={2}>
              {summary.mostWorn ? summary.mostWorn.item.name : t("insights.wears.mostWornNone")}
            </Text>
          </View>
          <Meta>{summary.mostWorn ? t("insights.wears.mostWornCount", { n: ltr(summary.mostWorn.count) }) : t("insights.wears.mostWorn")}</Meta>
        </View>
      </View>

      <DayStrip days={summary.days} daysWorn={summary.daysWorn} locale={locale} />

      <View className="mt-12">
        <Meta>{t("insights.wears.recent")}</Meta>
        <View className="mt-2 border-t border-hairline">
          {shown.map((o) => (
            <OutfitRow key={o.wearId} outfit={o} locale={locale} onOpenItem={onOpenItem} />
          ))}
        </View>
        {!all && summary.outfits.length > FIRST_PAGE ? (
          <View className="mt-2 items-start">
            <Button variant="text" label={t("insights.wears.showMore")} onPress={() => setAll(true)} />
          </View>
        ) : null}
      </View>
    </View>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  // items-start: on web a line that opens with digits or Latin takes LTR as its own direction and hugs the left edge
  // of a stretched box even in Hebrew. Shrunk to its content, the box itself sits at the start edge instead.
  return (
    <View className="flex-1 items-start">
      <Text className="font-mono text-display text-ink">{value}</Text>
      <Meta>{label}</Meta>
    </View>
  );
}

// Web: one tab stop for the strip (not 30), a group named by the summary; each square is an image named by its
// date and state, reachable with a screen reader's reading cursor. Native: one element read as the summary.
const stripGroupProps = (summary: string) =>
  Platform.OS === "web" ? { role: "group" as const, "aria-label": summary, focusable: true } : { accessible: true, accessibilityLabel: summary };

function DayStrip({ days, daysWorn, locale }: { days: WearSummary["days"]; daysWorn: number; locale: string }) {
  const { t } = useTranslation();
  const summary = spoken(t("insights.wears.stripSummary", { n: daysWorn, total: days.length }));
  const first = days[0];
  return (
    <View className="mt-8">
      <View {...stripGroupProps(summary)} className="flex-row" style={{ gap: DAY_GAP }} testID="wear-strip">
        {days.map((d) => (
          <View
            key={d.date}
            role="img"
            aria-label={t(d.worn ? "insights.wears.dayWorn" : "insights.wears.dayNotWorn", { date: longDate(d.date, locale) })}
            testID={`wear-day-${d.date}`}
            // Filled ink = worn; a hairline outline = not worn. The difference is the fill, not a hue.
            style={{ flex: 1, aspectRatio: 1, borderRadius: 2, borderWidth: 1 }}
            className={d.worn ? "border-ink bg-ink" : "border-hairline"}
          />
        ))}
      </View>
      <View className="mt-2 flex-row justify-between" importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
        <Text className="font-mono text-num-sm text-ink-soft">{first ? shortDate(first.date, locale) : ""}</Text>
        <Meta>{t("insights.wears.stripToday")}</Meta>
      </View>
    </View>
  );
}

function OutfitRow({
  outfit,
  locale,
  onOpenItem,
}: {
  outfit: WearSummary["outfits"][number];
  locale: string;
  onOpenItem: Props["onOpenItem"];
}) {
  const { t } = useTranslation();
  const scope = insightsScope(outfit.wearId);
  const pieces: FlatLayPiece[] = outfit.pieces.map((p, n) => ({
    slot: p.slot,
    item: p.item,
    index: String(n + 1).padStart(2, "0"),
    accessibilityLabel: spoken(t("insights.wears.piece", { name: p.item.name })),
  }));
  const tone = flatLayTone(pieces);
  const pressed = (slot: Slot) => {
    const id = pieces.find((p) => p.slot === slot)?.item.id;
    if (id) onOpenItem(scope, id);
  };
  const label = spoken(t("insights.wears.outfitLabel", { date: longDate(outfit.date, locale), pieces: pieces.map((p) => p.item.name).join(", ") }));
  return (
    <View className="flex-row border-b border-hairline py-4" style={{ gap: 16 }}>
      <View className="flex-1 items-start">
        <Text className="font-mono text-num text-ink">{shortDate(outfit.date, locale)}</Text>
        <Text className="font-body text-body-sm text-ink-soft">{weekday(outfit.date, locale)}</Text>
      </View>
      <View style={{ width: OUTFIT_W }}>
        <FlatLay
          pieces={pieces}
          numbered={false}
          radius="md"
          onPressPiece={pressed}
          onPieceNode={(id, node) => registerOrigin(scope, id, node, { tone, loose: true })}
          accessibilityLabel={label}
        />
      </View>
    </View>
  );
}

/** Loading: every block at its final height, so nothing jumps when the numbers land. */
function WearsSkeleton() {
  return (
    <View>
      <View className="flex-row" style={{ gap: 16 }}>
        {[0, 1, 2].map((n) => (
          <View key={n} className="flex-1" style={{ gap: 4 }}>
            <Skeleton height={NUMBER_H - 4} radius="sm" />
            <Skeleton height={14} width="70%" radius="sm" />
          </View>
        ))}
      </View>
      <View className="mt-8">
        <Skeleton height={12} radius="sm" />
      </View>
      <View className="mt-12" style={{ gap: 16 }}>
        {[0, 1, 2].map((n) => (
          <View key={n} className="flex-row" style={{ gap: 16 }}>
            <View className="flex-1" style={{ gap: 4 }}>
              <Skeleton height={22} width={56} radius="sm" />
              <Skeleton height={18} width={88} radius="sm" />
            </View>
            <View style={{ width: OUTFIT_W }}>
              <Skeleton aspect={1.25} />
            </View>
          </View>
        ))}
      </View>
    </View>
  );
}
