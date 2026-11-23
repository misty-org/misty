// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
// See NOTICE.

import { startActivityCounts } from "./activity";
import type { PerformanceContext } from "./diagnostics";
import { initializePerformancePreference } from "./preference";

export { PerformanceSection } from "./PerformanceSection";
export { DiagnosticsSection } from "./DiagnosticsSection";

const noContext = (): PerformanceContext => ({
  sessions: Number.NaN,
  messages: Number.NaN,
  streaming: Number.NaN,
});

export function startPerformanceRecording(context: () => PerformanceContext = noContext) {
  const stopPreference = initializePerformancePreference(context);
  const stopCounts = startActivityCounts();
  return () => {
    stopCounts();
    stopPreference();
  };
}
