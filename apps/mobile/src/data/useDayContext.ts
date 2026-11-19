import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { loadDayContext, type DayContext } from "./dayContext";
import { onLocationChange, onPlaceNameChange } from "./location";

/**
 * Today's context for the screen. `null` while loading; the loader itself never fails (see dayContext.ts).
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
  // The language is a dependency because the place name of "current location" is looked up in it.
  useEffect(() => {
    let active = true;
    void loadDayContext(new Date(), lang).then((c) => {
      if (active) setCtx(c);
    });
    return () => {
      active = false;
    };
  }, [version, lang]);
  return ctx;
}
