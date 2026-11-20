import { useTranslation } from "react-i18next";
import { TextTabs } from "../../components/ui";
import type { PhoneFreeDay } from "../../data/shabbatTimes";
import { dayTabKeys } from "./dayInForce";

/**
 * The day tabs (DESIGN.md "שלב 4.1" item 2): today, then each planned day, as the library `TextTabs` with the tabs
 * pattern's ids. One piece for Today and the saved outfit's screen, so both show the same tabs, labels and keyboard
 * behaviour (arrow keys move and select; focus stays on the tab). Renders nothing when the day has no planned day.
 *
 * @param idPrefix - ids of the tabs and the `TabPanel` they control; each screen its own.
 * @param inset - start and end padding of the scrolling row (the screen's gutter when the row is full-bleed).
 */
export function DayTabs(props: {
  day: { date: string; chain: readonly Pick<PhoneFreeDay, "date" | "kind">[] };
  value: string;
  onChange: (date: string) => void;
  inset: number;
  idPrefix: string;
}) {
  const { t } = useTranslation();
  const keys = dayTabKeys(props.day);
  if (keys.length === 0) return null;
  return (
    <TextTabs
      tabs={keys.map((k) => ({ key: k.key, label: t(k.labelKey) }))}
      value={props.value}
      onChange={props.onChange}
      accessibilityLabel={t("today.tabs.label")}
      inset={props.inset}
      idPrefix={props.idPrefix}
    />
  );
}
