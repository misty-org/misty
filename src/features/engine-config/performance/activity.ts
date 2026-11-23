import { engineConfigHost } from "../host";
import { performanceRecorder } from "./diagnostics";

const TEXT_EVENTS = new Set(["response.delta", "thinking.delta", "assistant.message"]);

export function startActivityCounts(): () => void {
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
