import { engineConfigHost } from "../host";
import { performanceRecorder } from "./diagnostics";

/** The run events that carry text: the answer and the thinking as they stream, and whole replies. */
const TEXT_EVENTS = new Set(["response.delta", "thinking.delta", "assistant.message"]);

/**
 * Feeds the performance panel's chat activity counts from the run event stream every window
 * already receives: every event counts as an engine event, tool starts, results and details as
 * tool events, and streamed or finished text as text events. Only counts are kept, never the
 * events themselves; the recorder drops them while the panel is off.
 */
export function startActivityCounts(): () => void {
  // Without an app to fill the host (a preview, a test) there are no runs to count.
  const watch = engineConfigHost.maybe()?.watchRunEvents;
  if (!watch) return () => undefined;
  return watch((_runId, event) => {
    if (!performanceRecorder.isEnabled()) return;
    performanceRecorder.count("engineEvents", 1);
    const type = (event as { type?: unknown }).type;
    if (typeof type !== "string") return;
    if (type.startsWith("tool.")) performanceRecorder.count("toolEvents", 1);
    else if (TEXT_EVENTS.has(type)) performanceRecorder.count("textEvents", 1);
  });
}
