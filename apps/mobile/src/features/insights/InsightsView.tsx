import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Button, ScreenColumn, ScreenHeader } from "../../components/ui";
import { fetchMonthSpend, fetchWornOutfits, summarizeSpend, summarizeWears, wearsToday, type AiCallRow, type WornOutfit } from "../../data/insights";
import { useWardrobe } from "../../data/WardrobeProvider";
import { SpendSection, type SpendState } from "./SpendSection";
import { WearsSection, type WearsState } from "./WearsSection";

type Load<T> = { kind: "loading" } | { kind: "error" } | { kind: "ready"; value: T };

/**
 * Loads `fetch` each time the screen gains focus (a wear logged on Today must show when the user comes back, and an
 * item opened from here returns to it). The last good value stays on screen while a refresh runs; a failed refresh after a good load keeps
 * it too, and only a failure with nothing to show becomes the error state.
 */
function useOnFocus<T>(fetch: () => Promise<T>): [Load<T>, () => void] {
  const [state, setState] = useState<Load<T>>({ kind: "loading" });
  // Bumped by a retry; part of the focus callback's identity, so the focus effect runs again at once.
  const [attempt, setAttempt] = useState(0);
  useFocusEffect(
    useCallback(() => {
      let active = true;
      void fetch().then(
        (value) => active && setState({ kind: "ready", value }),
        (error: unknown) => {
          console.error(`Insights load failed (attempt ${attempt})`, error);
          if (active) setState((prev) => (prev.kind === "ready" ? prev : { kind: "error" }));
        }
      );
      return () => {
        active = false;
      };
    }, [fetch, attempt])
  );
  const retry = useCallback(() => {
    setState({ kind: "loading" });
    setAttempt((n) => n + 1);
  }, []);
  return [state, retry];
}

// Module-level, so useOnFocus gets stable functions. "Now" is read at load time: a tab left open past midnight
// moves its window on the next focus. "Today" is the saved location's date (what Today uses and what wears are written
// with), not the device's: see wearsToday.
const loadWorn = async (): Promise<{ today: string; rows: WornOutfit[] }> => {
  const today = await wearsToday();
  return { today, rows: await fetchWornOutfits(today) };
};
const loadSpend = (): Promise<{ kind: "rows"; rows: AiCallRow[]; partial: boolean } | { kind: "unavailable" }> => fetchMonthSpend(new Date());

/**
 * Insights (DESIGN.md "שלב 2", "תובנות"): what was worn in the last 30 days and what AI cost this month. Two
 * sections, no cards, no colour beyond ink and hairline. A screen above the tabs, opened from the profile (stage
 * 5.2), with a back arrow above the title like the archive.
 * Data: worn outfits from `wears` (or the design-preview snapshot) joined to the loaded wardrobe; spend from the
 * user's own `ai_calls` rows (RLS). Each section loads and fails on its own, with its own retry.
 */
/** @param onBack - the back arrow: to the profile underneath (or to it, after a deep link). */
export function InsightsView({ onBack }: { onBack: () => void }) {
  const { t } = useTranslation();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const wardrobe = useWardrobe();

  const [worn, retryWorn] = useOnFocus(loadWorn);
  const [spend, retrySpend] = useOnFocus(loadSpend);

  const wears = useMemo<WearsState>(() => {
    if (wardrobe.status === "error") return { kind: "error", message: t("insights.wears.wardrobeFailed"), retry: wardrobe.reload };
    if (worn.kind === "error") return { kind: "error", message: t("insights.wears.failed"), retry: retryWorn };
    if (worn.kind === "loading" || wardrobe.status !== "ready") return { kind: "loading" };
    return { kind: "ready", summary: summarizeWears(worn.value.rows, wardrobe.items, worn.value.today) };
  }, [wardrobe, worn, retryWorn, t]);

  const spendState = useMemo<SpendState>(() => {
    if (spend.kind === "loading") return { kind: "loading" };
    if (spend.kind === "error") return { kind: "error", message: t("insights.spend.failed"), retry: retrySpend };
    if (spend.value.kind === "unavailable") return { kind: "unavailable" };
    return { kind: "ready", summary: summarizeSpend(spend.value.rows), partial: spend.value.partial };
  }, [spend, retrySpend, t]);

  const openItem = useCallback(
    // From a row of the outfit's sheet: no garment picture to fly from, so the item screen fades in.
    (id: string) => router.push({ pathname: "/item/[id]", params: { id } }),
    [router]
  );

  return (
    <View className="flex-1 bg-ivory">
      <ScrollView contentContainerStyle={{ flexGrow: 1, paddingBottom: 48 }}>
        <ScreenColumn>
          <View style={{ paddingTop: insets.top + 8 }}>
            {/* The glyph sits 10px inside its 44 box; pulling the box out by 8 lines the arrow up with the title's edge. */}
            <View style={{ alignSelf: "flex-start", marginStart: -8 }}>
              <Button variant="icon" icon="arrow_back" accessibilityLabel={t("common.back")} onPress={onBack} />
            </View>
            <ScreenHeader title={t("insights.title")} safeArea={false} />
          </View>
          <View className="mt-8">
            <WearsSection state={wears} onOpenItem={openItem} onEmptyAction={() => router.navigate("/")} />
          </View>
          <View className="mt-12">
            <SpendSection state={spendState} />
          </View>
        </ScreenColumn>
      </ScrollView>
    </View>
  );
}
