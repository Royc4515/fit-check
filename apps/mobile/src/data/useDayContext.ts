import { useEffect, useState } from "react";
import { loadDayContext, type DayContext } from "./dayContext";
import { onLocationChange } from "./location";

/**
 * Today's context for the screen. `null` while loading; the loader itself never fails (see dayContext.ts).
 * Reloads when the location setting changes, so coming back from the location screen shows the new place.
 */
export function useDayContext(): DayContext | null {
  const [ctx, setCtx] = useState<DayContext | null>(null);
  const [version, setVersion] = useState(0);
  useEffect(() => onLocationChange(() => setVersion((v) => v + 1)), []);
  useEffect(() => {
    let active = true;
    void loadDayContext().then((c) => {
      if (active) setCtx(c);
    });
    return () => {
      active = false;
    };
  }, [version]);
  return ctx;
}
