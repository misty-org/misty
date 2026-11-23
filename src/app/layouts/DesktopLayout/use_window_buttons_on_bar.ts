import { useEffect, useLayoutEffect, useRef } from "react";
import { setTrafficLightsVisible } from "@/native/runtime";
import { hasTauriInternals } from "@/shared/platform/tauri";
import { barHeight, slideMs } from "./space_bar_timing";
import { dockingMetrics } from "./docking_geometry";

export function useWindowButtonsOnBar(holdsWindowButtons: boolean, open: boolean) {
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
