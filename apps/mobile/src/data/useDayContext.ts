import { useEffect, useState } from "react";
import { loadDayContext, type DayContext } from "./dayContext";

/** Today's context for the screen. `null` while loading; the loader itself never fails (see dayContext.ts). */
export function useDayContext(): DayContext | null {
  const [ctx, setCtx] = useState<DayContext | null>(null);
  useEffect(() => {
    let active = true;
    void loadDayContext().then((c) => {
      if (active) setCtx(c);
    });
    return () => {
      active = false;
    };
  }, []);
  return ctx;
}
