import { useRouter } from "expo-router";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, Text, View } from "react-native";
import { Display, Meta } from "../../components/ui";
import { focusRingProps } from "../../components/ui/interaction";
import { localDate, localTime, type DayContext, type PlannedDay } from "../../data/dayContext";
import { layout } from "../../theme/tokens";

/** Wraps digits and the degree/percent signs so they stay LTR inside Hebrew text (DESIGN.md: numbers always LTR). */
export const ltr = (s: string) => `⁦${s}⁩`;

/** A line kept at its height while its data is on its way: one non-breaking space, hidden from readers. */
function HeldLine({ className }: { className: string }) {
  return (
    <View aria-hidden importantForAccessibility="no-hide-descendants">
      <Text className={className}>{" "}</Text>
    </View>
  );
}

/**
 * A planned day's own forecast, named by its day (DESIGN.md "שלב 4.1" item 8): "Shabbat · 14–22° · rain 0%", or "no
 * forecast yet". On today's tab (`planned` null) the line is held empty and hidden from readers, so a tab change does
 * not move the hero by a line's height. Today's frame and the screen with its outfit both draw it.
 */
export function PlannedForecastLine({ planned }: { planned: PlannedDay | null }) {
  const { t, i18n } = useTranslation();
  const locale = i18n.language === "en" ? "en" : "he";
  if (!planned)
    return (
      <View aria-hidden importantForAccessibility="no-hide-descendants" style={{ opacity: 0 }}>
        <Meta>{" "}</Meta>
      </View>
    );
  const name =
    planned.dayType === "shabbat" ? t("today.dayType.shabbat") : new Intl.DateTimeFormat(locale, { weekday: "long" }).format(new Date(`${planned.date}T12:00:00`));
  return (
    <Meta>
      {planned.weather
        ? t("today.plannedForecast", {
            day: name,
            range: ltr(`${planned.weather.temp_min_c}–${planned.weather.temp_max_c}°`),
            rain: ltr(`${Math.round(planned.weather.rain_probability * 100)}%`),
          })
        : t("today.plannedNoForecast")}
    </Meta>
  );
}

/**
 * Today's masthead (DESIGN.md section 3 "היום" item 1): the title with the screen's secondary action at the end of its
 * row, the Hebrew and civil dates, the Shabbat-times row, and the weather with the place (it opens the location
 * screen). One piece for Today's frame and for the screen with its outfit, so the two draw the same boxes and nothing
 * moves when the outfit arrives.
 *
 * Every line is drawn from what the day holds now, and fills in place when its data arrives (DESIGN.md "היום" item 1,
 * "המסגרת קודם"): the Hebrew date joins the date line; the weather line is held at its height while the forecast is
 * on its way and nothing is stored, then shows the forecast or says there is none; on a Friday or a Saturday (which
 * always have a times row) the times row is held while the calendar is on its way and says the times are missing once
 * it is no longer waited for. Nothing on it is a guess.
 *
 * @param titleAction - at the end of the title's row (the bookmark on the screen with an outfit; none in the frame).
 * @param weatherSettled - the forecast is no longer waited for (answered, failed or past its bound).
 * @param calendarSettled - the same for the Hebrew calendar.
 */
export function Masthead({
  day,
  titleAction,
  children,
  weatherSettled,
  calendarSettled,
}: {
  day: DayContext;
  titleAction?: ReactNode;
  /** Rendered under the title row, out of the flow (the bookmark's live region). */
  children?: ReactNode;
  weatherSettled: boolean;
  calendarSettled: boolean;
}) {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const locale = i18n.language === "en" ? "en" : "he";
  const gregorian = new Intl.DateTimeFormat(locale, { weekday: "long", day: "numeric", month: "long" }).format(new Date(`${day.date}T12:00:00`));
  const hebrew = day.hebrewDate?.[locale];
  const place = day.place ?? (day.usesCurrentLocation ? t("location.currentShort") : t("location.default"));
  const w = day.weather;
  // No forecast yet and none stored, while the request is still waited for: the line keeps its place and says nothing.
  const weatherHeld = !w && day.forecast.pending && !weatherSettled;

  const weatherLine = w ? (
    <Text className="font-mono text-num text-ink">
      {ltr(`${w.temp_min_c}–${w.temp_max_c}°`)}
      {/* Plex Mono has no Hebrew: words switch to the body face inside the same line. */}
      <Text className="font-body text-ink-soft">{"  ·  "}</Text>
      <Text className="font-body">{`${t("today.data.rain")} `}</Text>
      {ltr(`${Math.round(w.rain_probability * 100)}%`)}
      <Text className="font-body text-ink-soft">{"  ·  "}</Text>
      <Text className="font-body">{t(`today.sky.${w.sky}`)}</Text>
    </Text>
  ) : weatherHeld ? (
    <HeldLine className="font-mono text-num text-ink" />
  ) : (
    <Text className="font-body text-body-sm text-ink-soft">{t("today.noWeather")}</Text>
  );
  // The weather line is from an older forecast (the network has not answered, or failed): say from when, in the
  // location's clock, and "yesterday" when it was fetched on an earlier date (it is kept at most a day).
  const source = day.forecast.source;
  const forecastAge =
    w && source.kind === "cached"
      ? {
          key: localDate(day.tz, new Date(source.at)).date === day.date ? "today.forecastFrom" : "today.forecastFromYesterday",
          time: localTime(day.tz, new Date(source.at)),
        }
      : null;
  const weatherWords = w
    ? [
        `${w.temp_min_c}–${w.temp_max_c}°, ${t("today.data.rain")} ${Math.round(w.rain_probability * 100)}%, ${t(`today.sky.${w.sky}`)}`,
        forecastAge ? `${t(forecastAge.key)}${ltr(forecastAge.time)}` : null,
      ]
        .filter(Boolean)
        .join(", ")
    : weatherHeld
      ? t("today.weatherPending")
      : t("today.noWeather");

  // Spec DESIGN.md section 3 "היום" item 1: the entry line is named by the day, the end joins it only when it is
  // today or tomorrow (data/shabbatTimes.ts decides that).
  const entryLine = day.candles ? t(day.candles.kind === "shabbat" ? "today.candles" : "today.candlesOther", { time: ltr(day.candles.time) }) : null;
  // "tomorrow" only when the end is tomorrow's and today is not a Friday: on a Friday every calendar prints just
  // "Shabbat ends 17:17", on any other day a bare time would read as ending before the candles (DESIGN.md "היום").
  const endTomorrow = day.end?.day === "tomorrow" && day.candles?.kind !== "shabbat";
  const endKeys = {
    shabbat: ["today.shabbatEnd", "today.shabbatEndTomorrow"],
    holiday: ["today.holidayEnd", "today.holidayEndTomorrow"],
    fast: ["today.fastEnd", "today.fastEndTomorrow"],
  } as const;
  const endLine = day.end ? t(endKeys[day.end.kind][endTomorrow ? 1 : 0], { time: ltr(day.end.time) }) : null;
  const timesLine = entryLine && endLine ? t("today.timesJoin", { first: entryLine, second: endLine }) : (entryLine ?? endLine);
  // A Friday and a Saturday always have a times row; any other day may or may not (a holiday eve), so its row is not
  // held: holding it would make the ordinary day jump when the calendar says there is none.
  const timesExpected = day.observes && !day.calendar.known && (day.weekday === 5 || day.weekday === 6);
  const timesClass = "mt-1 font-body text-body-sm text-ink-soft";
  const times = timesLine ? (
    <Text className={timesClass}>{timesLine}</Text>
  ) : timesExpected ? (
    calendarSettled ? (
      <Text className={timesClass}>{t("today.timesMissing")}</Text>
    ) : (
      <HeldLine className={timesClass} />
    )
  ) : null;

  return (
    <View>
      {/* The title row: the bookmark is a secondary action of the screen, so it sits at the end of the title's row
          (DESIGN.md section 3 "שלד"). The title's line is 46 high and the button 44, so the row keeps the height the
          title alone had, with or without the button. */}
      <View className="flex-row items-center" style={{ gap: 8 }}>
        <View className="flex-1">
          <Display size="display-xl" level={1}>
            {t("today.title")}
          </Display>
        </View>
        {titleAction}
      </View>
      {children}
      <Text className="mt-2 font-body text-body-sm text-ink-soft">{hebrew ? `${hebrew} · ${gregorian}` : gregorian}</Text>
      {times}
      <Pressable
        {...focusRingProps}
        onPress={() => router.push("/location")}
        accessibilityRole="button"
        accessibilityLabel={t("today.weatherLabel", { weather: weatherWords, place })}
        className="mt-4 self-start"
        style={{ minHeight: layout.hit }}
      >
        {weatherLine}
        {/* The place is the link's visible half: underlined like every text action, so the line reads as tappable. An
            older forecast says how old beside it, on the same row, so the masthead keeps its height when the fresh one
            arrives and the note leaves. */}
        <View className="mt-1 flex-row flex-wrap items-center self-start" style={{ columnGap: 8 }}>
          <View className="border-b border-hairline pb-1">
            <Meta tone="text-ink-soft">{place}</Meta>
          </View>
          {forecastAge ? (
            <Meta tone="text-ink-soft" className="pb-1">
              {`· ${t(forecastAge.key)}`}
              <Text className="font-mono text-num-sm">{ltr(forecastAge.time)}</Text>
            </Meta>
          ) : null}
        </View>
      </Pressable>
    </View>
  );
}
