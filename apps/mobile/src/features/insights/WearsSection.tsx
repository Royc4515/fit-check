import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Platform, Pressable, Text, View } from "react-native";
import { Button, Display, EmptyState, FlatLay, ListRow, Meta, Sheet, Skeleton, StatusLine, type FlatLayPiece } from "../../components/ui";
import { focusRingProps } from "../../components/ui/interaction";
import type { WearSummary } from "../../data/insights";
import { isRtl } from "../../i18n";
import { colors, layout } from "../../theme/tokens";
import { tokens } from "../../theme/tokens.base.js";
import { spoken } from "../item/a11y";
import { longDate, ltr, shortDate, weekday } from "./format";

/** Outfits listed before "show more" (brief: up to 10). */
const FIRST_PAGE = 10;
/** Gap between the strip's day squares (spacing scale). */
const DAY_GAP = 4;
/** Line height of the big mono numbers: the `num-lg` token's, so the skeleton and the figures have the same height. */
const NUMBER_H = Number.parseInt(tokens.fontSize["num-lg"]?.[1].lineHeight ?? "34", 10);

export type WearsState =
  | { kind: "loading" }
  | { kind: "error"; message: string; retry: () => void }
  | { kind: "ready"; summary: WearSummary };

type Props = {
  state: WearsState;
  /** A garment was chosen in an outfit's sheet: open its item. */
  onOpenItem: (itemId: string) => void;
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

type Outfit = WearSummary["outfits"][number];

function WearsContent({ summary, onOpenItem }: { summary: WearSummary; onOpenItem: Props["onOpenItem"] }) {
  const { t, i18n } = useTranslation();
  const locale = i18n.language === "en" ? "en" : "he";
  const [all, setAll] = useState(false);
  const [open, setOpen] = useState<Outfit | null>(null);
  const shown = all ? summary.outfits : summary.outfits.slice(0, FIRST_PAGE);
  // Closing first: the item route is pushed over a screen with no modal left on it.
  const openItem = (id: string) => {
    setOpen(null);
    onOpenItem(id);
  };
  return (
    <View>
      {/* Columns stretch to one height and each stacks from the bottom (justify-end), so the three labels share a baseline whatever the name above one wraps to. */}
      <View className="flex-row items-stretch" style={{ gap: 16 }}>
        <Stat value={ltr(summary.daysWorn)} label={t("insights.wears.daysWorn")} />
        <Stat value={ltr(summary.distinctItems)} label={t("insights.wears.distinctItems")} />
        {/* The third stat is a name and a longer label ("הנלבש ביותר · 3 פעמים"), so it gets the wider column. */}
        <View className="items-start justify-end" style={{ flex: 2 }}>
          {summary.mostWorn ? (
            // A name, not a figure: body type, two lines at most. Text direction LTR so a Latin name truncates at its end
            // ("Detroit Jacket…", not "…Detroit Jacket"), and an explicit alignment to the start edge of the UI direction, so
            // the block sits where the other two stats do.
            <Text className="font-body text-body text-ink" numberOfLines={2} style={{ writingDirection: "ltr", textAlign: isRtl() ? "right" : "left" }}>
              {summary.mostWorn.item.name}
            </Text>
          ) : (
            <Text className="font-body text-body text-ink">{t("insights.wears.mostWornNone")}</Text>
          )}
          {/* One line, never wrapped mid-phrase: the column is wide enough for it. */}
          <Meta numberOfLines={1}>{summary.mostWorn ? t("insights.wears.mostWornCount", { count: summary.mostWorn.count }) : t("insights.wears.mostWorn")}</Meta>
        </View>
      </View>

      <DayStrip days={summary.days} daysWorn={summary.daysWorn} locale={locale} />

      <View className="mt-12">
        <Meta>{t("insights.wears.recent")}</Meta>
        <View className="mt-2 border-t border-hairline">
          {shown.map((o) => (
            <OutfitRow key={o.wearId} outfit={o} locale={locale} onPress={() => setOpen(o)} />
          ))}
        </View>
        {!all && summary.outfits.length > FIRST_PAGE ? (
          <View className="mt-2 items-start">
            <Button variant="text" label={t("insights.wears.showMore")} onPress={() => setAll(true)} />
          </View>
        ) : null}
      </View>

      <Sheet open={open !== null} onClose={() => setOpen(null)} title={open ? longDate(open.date, locale) : undefined} accessibilityLabel={open ? longDate(open.date, locale) : undefined}>
        {/* Kept after close for the sheet's exit animation: `open` is null, so the last outfit is simply not drawn. */}
        {open?.items.map((item) => (
          <ListRow key={item.id} label={`${t(`item.subcategory.${item.tags.subcategory}`)} · ${item.name}`} onPress={() => openItem(item.id)} />
        ))}
      </Sheet>
    </View>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  // items-start: on web a line that opens with digits or Latin takes LTR as its own direction and hugs the left edge
  // of a stretched box even in Hebrew. Shrunk to its content, the box itself sits at the start edge instead.
  return (
    <View className="flex-1 items-start justify-end">
      <Text className="font-mono text-num-lg text-ink">{value}</Text>
      <Meta>{label}</Meta>
    </View>
  );
}

// Web: one tab stop for the strip (not 30), a group named by the summary; each square is an image named by its
// date and state, reachable with a screen reader's reading cursor. Native: one element read as the summary.
const stripGroupProps = (summary: string) =>
  Platform.OS === "web"
    ? { role: "group" as const, "aria-label": summary, focusable: true, ...focusRingProps }
    : { accessible: true, accessibilityLabel: summary };

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
            // Filled ink = worn; an ink-faint outline (4.8:1 on ivory) = not worn: the fill is the difference, and the
            // empty square stays visible against the page (the hairline was 1.3:1).
            style={{ flex: 1, aspectRatio: 1, borderRadius: 2, borderWidth: 1 }}
            className={d.worn ? "border-ink bg-ink" : "border-ink-faint"}
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

/**
 * One worn outfit. The whole row is the button (DESIGN.md "תובנות": the small garments are under 44, so they are not
 * targets): its name is the date and the garments' names, and it opens a sheet of the garments. The flat-lay is only
 * a picture here, hidden from assistive tech, since the row already says what it shows.
 */
function OutfitRow({ outfit, locale, onPress }: { outfit: Outfit; locale: string; onPress: () => void }) {
  const { t } = useTranslation();
  const pieces: FlatLayPiece[] = outfit.pieces.map((p, n) => ({
    slot: p.slot,
    item: p.item,
    index: String(n + 1).padStart(2, "0"),
    accessibilityLabel: p.item.name,
  }));
  const label = spoken(t("insights.wears.outfitLabel", { date: longDate(outfit.date, locale), pieces: outfit.items.map((i) => i.name).join(", ") }));
  return (
    <Pressable
      {...focusRingProps}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={t("insights.wears.rowHint")}
      style={({ pressed }) => ({ minHeight: layout.hit, backgroundColor: pressed ? colors["ivory-deep"] : undefined })}
      testID={`outfit-row-${outfit.wearId}`}
    >
      <View className="flex-row border-b border-hairline py-4" style={{ gap: 16 }}>
        <View className="flex-1 items-start">
          <Text className="font-mono text-num text-ink">{shortDate(outfit.date, locale)}</Text>
          <Text className="font-body text-body-sm text-ink-soft">{weekday(outfit.date, locale)}</Text>
        </View>
        <View className="w-24" importantForAccessibility="no-hide-descendants" accessibilityElementsHidden aria-hidden>
          <FlatLay pieces={pieces} numbered={false} radius="md" pieceFocusable={false} accessibilityLabel={label} />
        </View>
      </View>
    </Pressable>
  );
}

/** Loading: every block at its final height, so nothing jumps when the numbers land. */
function WearsSkeleton() {
  return (
    <View>
      <View className="flex-row" style={{ gap: 16 }}>
        {[0, 1, 2].map((n) => (
          <View key={n} className="flex-1" style={{ gap: 4 }}>
            <Skeleton height={NUMBER_H} radius="sm" />
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
              <Skeleton height={22} width={64} radius="sm" />
              <Skeleton height={18} width={96} radius="sm" />
            </View>
            <View className="w-24">
              <Skeleton aspect={1.25} />
            </View>
          </View>
        ))}
      </View>
    </View>
  );
}
