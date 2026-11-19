import type { DayAdjustment } from "@fit-check/engine";
import { OCCASION_TYPES, type OccasionType } from "@fit-check/schema";
import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { Button, Chip, Meta, Sheet, Stepper } from "../../components/ui";

export type Adjust = "warmer" | "cooler" | "dressier" | "casual";

type Props = {
  open: boolean;
  onClose: () => void;
  /** Today's taps only (not the learned lean): what "reset" undoes and what the steppers count. */
  adjustment: DayAdjustment;
  onAdjust: (a: Adjust) => void;
  onReset: () => void;
  /** Absent when there is nothing to skip to (worn, empty). */
  onSkip?: () => void;
  /** A write is in flight. */
  busy: boolean;
  /** What is on the day (DESIGN.md "שלב 4.5" item 1), null for none. */
  occasion?: OccasionType | null;
  /** "What's on today". */
  occasionTitle?: string;
  /**
   * Picks an occasion, or with null clears it; the sheet closes, as after a skip (the result is another look).
   * Absent where no occasion can apply (a planned day's tab, Shabbat or a holiday before its havdalah): no chips.
   */
  onOccasion?: (type: OccasionType | null) => void;
};

/**
 * The secondary decisions about today's suggestion (DESIGN.md section 3 "היום" item 6), behind the `tune` button:
 * temperature and formality as steppers (taps stack, so they are counts, not choices), then skip, then reset when
 * something was nudged. Nudges leave the sheet open, so two taps in a row need no reopening and the outfit can be
 * seen changing above it; skip closes it, because its result is a different outfit.
 */
export function AdjustSheet({ open, onClose, adjustment, onAdjust, onReset, onSkip, busy, occasion, occasionTitle, onOccasion }: Props) {
  const { t } = useTranslation();
  const active = adjustment.temp_steps !== 0 || adjustment.formality_steps !== 0;
  return (
    <Sheet open={open} onClose={onClose} title={t("today.adjustTitle")}>
      <View style={{ gap: 24 }}>
        {/* First, above temperature: one choice, the chosen chip in ink; tapping it again clears it. */}
        {onOccasion ? (
          <View>
            <Meta tone="text-ink-soft">{occasionTitle}</Meta>
            <View className="mt-2 flex-row flex-wrap" style={{ gap: 8 }}>
              {OCCASION_TYPES.map((type) => (
                <Chip
                  key={type}
                  label={t(`today.occasion.type.${type}`)}
                  selected={occasion === type}
                  disabled={busy}
                  onPress={() => onOccasion(occasion === type ? null : type)}
                />
              ))}
            </View>
          </View>
        ) : null}
        <View>
          <Meta tone="text-ink-soft">{t("today.adjustTemp")}</Meta>
          <Stepper
            accessibilityLabel={t("today.adjustTemp")}
            value={adjustment.temp_steps}
            decrease={{ label: t("today.cooler"), onPress: () => onAdjust("cooler") }}
            increase={{ label: t("today.warmer"), onPress: () => onAdjust("warmer") }}
            disabled={busy}
          />
        </View>
        <View>
          <Meta tone="text-ink-soft">{t("today.adjustFormality")}</Meta>
          <Stepper
            accessibilityLabel={t("today.adjustFormality")}
            value={adjustment.formality_steps}
            decrease={{ label: t("today.casual"), onPress: () => onAdjust("casual") }}
            increase={{ label: t("today.dressier"), onPress: () => onAdjust("dressier") }}
            disabled={busy}
          />
        </View>
        <View className="flex-row flex-wrap" style={{ columnGap: 24 }}>
          {onSkip ? <Button variant="text" label={t("today.skip")} onPress={onSkip} disabled={busy} /> : null}
          {active ? <Button variant="text" label={t("today.adjust.reset")} onPress={onReset} disabled={busy} /> : null}
        </View>
      </View>
    </Sheet>
  );
}
