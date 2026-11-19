import type { Item } from "@fit-check/schema";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Text, View } from "react-native";
import { Button, Display, Meta, Skeleton, StatusLine } from "../../components/ui";
import { layout } from "../../theme/tokens";
import { spoken } from "./a11y";
import type { WearState } from "./useItemWears";
import { otherPieces, shortWearDate, longWearDate, wearSummary } from "./wears";

/** Rows shown before "show all" (DESIGN.md "שלב 2"). */
const FIRST_ROWS = 5;
/** The summary is one body line: 27 high (DESIGN.md body 16/27), the space the skeleton keeps for it. */
const SUMMARY_LINE = 27;

type Props = {
  itemId: string;
  /** The wardrobe, for the names of the other pieces of each outfit. */
  items: readonly Item[];
  state: WearState;
  onRetry: () => void;
  /** The current year, so a wear from this year is written without one. Injected for the gallery fixture. */
  currentYear?: number;
};

/**
 * "לבישות" on the item screen (DESIGN.md section 3 "שלב 2"): one summary line in body ("worn N times · last on
 * <date>", or "not worn yet"), then the most recent wears as hairline rows, the date in mono and the outfit's other
 * pieces in body-sm ink-soft on one truncated line; "show all" expands the list in place. Loading keeps the
 * summary's line with a skeleton; a failed read says so with a retry.
 */
export function WearHistory({ itemId, items, state, onRetry, currentYear = new Date().getFullYear() }: Props) {
  const { t, i18n } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const locale = i18n.language;
  const names = useMemo(() => new Map(items.map((i) => [i.id, i.name])), [items]);
  // Page start, not the script's: a Latin name list inside a Hebrew page would otherwise hang off the far edge.
  // Logical, so it follows the drawn direction on native too, also before a restart (verification D9).
  const align = { textAlign: "start" } as const;

  let body;
  if (state.status === "loading") {
    body = <Skeleton width="60%" height={SUMMARY_LINE} radius="sm" />;
  } else if (state.status === "failed") {
    body = <StatusLine variant="error" message={t("item.wears.failed")} action={{ label: t("item.wears.retry"), onPress: onRetry }} />;
  } else {
    const { total, wears } = state.history;
    const summary = wearSummary(t, total, wears[0]?.date ?? null, locale, currentYear);
    const shown = expanded ? wears : wears.slice(0, FIRST_ROWS);
    body = (
      <>
        <Text className="font-body text-body text-ink" style={align} accessibilityLabel={spoken(summary)}>
          {summary}
        </Text>
        {shown.length > 0 ? (
          <View className="mt-4 border-t border-hairline">
            {shown.map((w) => {
              const pieces = otherPieces(w, itemId, names).join(", ");
              return (
                <View key={w.wearId} className="flex-row items-center border-b border-hairline py-3" style={{ gap: 16, minHeight: layout.hit }}>
                  {/* Digits on screen, the date in words for a screen reader (no isolates, no "16.11.26"). */}
                  <Text className="font-mono text-num-sm text-ink" accessibilityLabel={spoken(longWearDate(w.date, locale, currentYear))}>
                    {shortWearDate(w.date, locale)}
                  </Text>
                  <Text className="flex-1 font-body text-body-sm text-ink-soft" style={align} numberOfLines={1}>
                    {pieces}
                  </Text>
                </View>
              );
            })}
          </View>
        ) : null}
        {/* Only the newest ITEM_WEARS_LIMIT are fetched; when the count says more, the full list says where it stops
            instead of claiming to be all of them (verification D16). */}
        {shown.length === wears.length && total > wears.length ? (
          <View className="mt-2">
            <Meta>{t("item.wears.capped", { n: wears.length })}</Meta>
          </View>
        ) : null}
        {wears.length > FIRST_ROWS ? (
          <View className="mt-2">
            <Button
              variant="text"
              label={expanded ? t("item.wears.showLess") : t("item.wears.showAll")}
              expanded={expanded}
              onPress={() => setExpanded((e) => !e)}
            />
          </View>
        ) : null}
      </>
    );
  }

  return (
    <View>
      <Display>{t("item.wears.title")}</Display>
      <View className="mt-4">{body}</View>
    </View>
  );
}
