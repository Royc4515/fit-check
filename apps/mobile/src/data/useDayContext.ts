import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { loadDayContext, type DayContext } from "./dayContext";
import { onLocationChange, onPlaceNameChange } from "./location";
import { useObservesShabbat } from "./useObservance";

/**
 * Today's context for the screen. `null` while loading; the loader itself never fails (see dayContext.ts). May be
 * delivered twice per load: first without the forecast's network answer (`forecast.pending`), then with it.
 * Reloads when the location setting changes, so coming back from the location screen shows the new place.
 */
export function useDayContext(): DayContext | null {
  const [ctx, setCtx] = useState<DayContext | null>(null);
  const [version, setVersion] = useState(0);
  useEffect(() => onLocationChange(() => setVersion((v) => v + 1)), []);
  // A lookup that finished after the first paint stores its name and says so here: reload once to show it. The reload
  // finds the name in the cache and asks nothing, so this cannot loop.
  useEffect(() => onPlaceNameChange(() => setVersion((v) => v + 1)), []);
  const { i18n } = useTranslation();
  const lang = i18n.language === "en" ? "en" : "he";
  // The profile's "keeps Shabbat and holidays": switching it reloads the day here, no app reload needed.
  const observes = useObservesShabbat();
  // The language is a dependency because the place name of "current location" is looked up in it.
  // The day arrives without waiting for the forecast's request; when that settles the day comes again with it (the
  // weather line updates; Today decides what the outfit on screen does with it).
  useEffect(() => {
    let active = true;
    // don't touch / once a day with the settled forecast is delivered, a pending one of the same load is older and
    // must not replace it (the two can arrive in either order when the request settles in the same tick).
    let settled = false;
    const deliver = (c: DayContext) => {
      if (!active || (settled && c.forecast.pending)) return;
      if (!c.forecast.pending) settled = true;
      setCtx(c);
    };
    void loadDayContext(new Date(), lang, observes, deliver).then(deliver);
    return () => {
      active = false;
    };
  }, [version, lang, observes]);
  return ctx;
}
