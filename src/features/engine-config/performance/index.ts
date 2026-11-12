// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
// See NOTICE.

import { startActivityCounts } from "./activity";
import type { PerformanceContext } from "./diagnostics";
import { initializePerformancePreference } from "./preference";

export { PerformanceSection } from "./PerformanceSection";
/** Where the chat can time its renders; engine, tool and text events are counted here already. */
export { performanceRecorder, type PerformanceContext } from "./diagnostics";

/** No session or message counts are wired in yet; non-finite counts mark the context as
 *  unavailable. */
const noContext = (): PerformanceContext => ({
  sessions: Number.NaN,
  messages: Number.NaN,
  streaming: Number.NaN,
});

/**
 * Starts the window's side of the performance panel (event-loop lag, long tasks, and the chat's
 * engine, tool and text event counts) once the saved preference is read. Call once as the window
 * starts; returns the stop function.
 */
export function startPerformanceRecording(context: () => PerformanceContext = noContext) {
  const stopPreference = initializePerformancePreference(context);
  const stopCounts = startActivityCounts();
  return () => {
    stopCounts();
    stopPreference();
  };
}
