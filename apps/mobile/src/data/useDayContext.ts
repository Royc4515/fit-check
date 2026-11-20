import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { loadDayContext, onDayContextReload, type DayContext } from "./dayContext";
import { onLocationChange, onPlaceNameChange } from "./location";
import { useObservesShabbat } from "./useObservance";

/**
 * Today's context for the screen. `null` only until the device's own data is read (the location and what is stored):
 * no outside service is waited for (dayContext.ts loadDayContext). Delivered again each time the forecast, the
 * calendar or the Hebrew date settles, in order. Reloads when the location setting changes, so coming back from the
 * location screen shows the new place, and on reloadDayContext (the calendar line's "try again").
 */
export function useDayContext(): DayContext | null {
  const [ctx, setCtx] = useState<DayContext | null>(null);
  const [version, setVersion] = useState(0);
  useEffect(() => onLocationChange(() => setVersion((v) => v + 1)), []);
  // A lookup that finished after the first paint stores its name and says so here: reload once to show it. The reload
  // finds the name in the cache and asks nothing, so this cannot loop.
  useEffect(() => onPlaceNameChange(() => setVersion((v) => v + 1)), []);
  useEffect(() => onDayContextReload(() => setVersion((v) => v + 1)), []);
  const { i18n } = useTranslation();
  const lang = i18n.language === "en" ? "en" : "he";
  // The profile's "keeps Shabbat and holidays": switching it reloads the day here, no app reload needed.
  const observes = useObservesShabbat();
  // The language is a dependency because the place name of "current location" is looked up in it.
  useEffect(() => {
    let active = true;
    // don't touch / only the callback delivers: the loader calls it with the first day and then with each later one,
    // in order, so an older day can never replace a newer one (the returned promise could resolve after an update).
    void loadDayContext(new Date(), lang, observes, (c) => {
      if (active) setCtx(c);
    });
    return () => {
      active = false;
    };
  }, [version, lang, observes]);
  return ctx;
}
