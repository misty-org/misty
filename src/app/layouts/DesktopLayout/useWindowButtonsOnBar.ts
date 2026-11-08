import { useEffect, useLayoutEffect, useRef } from "react";
import { setTrafficLightsVisible } from "@/native/runtime";
import { hasTauriInternals } from "@/shared/platform/tauri";
import { barHeight, slideMs } from "./spaceBarTiming";
import { dockingMetrics } from "./dockingGeometry";

/** With tabs on the right the window buttons sit in the Space bar and travel with it. */
export function useWindowButtonsOnBar(holdsWindowButtons: boolean, open: boolean) {
  // The window buttons ride the bar: they start with the slide above, at its speed, and travel as
  // far as the bar does. The first state is applied without motion.
  const lightsSettled = useRef(false);
  useLayoutEffect(() => {
    if (!holdsWindowButtons || !hasTauriInternals()) return;
    const duration = lightsSettled.current ? slideMs : 0;
    lightsSettled.current = true;
    void setTrafficLightsVisible(open, 0, duration, barHeight + dockingMetrics.gap).catch(
      () => undefined,
    );
  }, [holdsWindowButtons, open]);
  useEffect(() => {
    if (!holdsWindowButtons || !hasTauriInternals()) return;
    return () => {
      lightsSettled.current = false;
      void setTrafficLightsVisible(true).catch(() => undefined);
    };
  }, [holdsWindowButtons]);
}
