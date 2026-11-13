import { create } from "zustand";
import { watchAllRunEvents } from "../../../runs/local-run/localRunEvents";

/** How full an engine's context was at a run's last report: tokens held, and the model's window. */
export interface ContextUsage {
  used?: number;
  window?: number;
  /** The report's token buckets, which don't overlap. */
  input?: number;
  output?: number;
  cacheRead?: number;
  cacheWrite?: number;
  model?: string;
}

interface ContextUsageState {
  byRun: Record<string, ContextUsage>;
}

const useContextUsageStore = create<ContextUsageState>(() => ({ byRun: {} }));

let watching = false;

/** Starts keeping each run's latest usage report. Native code sends only the two numbers. */
export function watchContextUsage() {
  if (watching) return;
  watching = true;
  try {
    watchAllRunEvents(keepUsage);
  } catch {
    // Outside the app's own window there are no run events to keep.
    watching = false;
  }
}

function keepUsage(runId: string, event: { type: string }) {
  const report = event as {
    type: string;
    used?: number | null;
    window?: number | null;
    input?: number;
    output?: number;
    cacheRead?: number;
    cacheWrite?: number;
    model?: string;
  };
  if (report.type !== "usage.updated") return;
  useContextUsageStore.setState((state) => {
    const previous = state.byRun[runId] ?? {};
    // Buckets describe one report, so a report that has any replaces them all.
    const buckets =
      report.input !== undefined ||
      report.output !== undefined ||
      report.cacheRead !== undefined ||
      report.cacheWrite !== undefined;
    return {
      byRun: {
        ...state.byRun,
        [runId]: {
          used: report.used ?? previous.used,
          window: report.window ?? previous.window,
          input: buckets ? report.input : previous.input,
          output: buckets ? report.output : previous.output,
          cacheRead: buckets ? report.cacheRead : previous.cacheRead,
          cacheWrite: buckets ? report.cacheWrite : previous.cacheWrite,
          model: report.model ?? previous.model,
        },
      },
    };
  });
}

/** The latest usage among a chat's runs, newest run first. */
export function useChatContextUsage(runIds: string[]): ContextUsage | undefined {
  return useContextUsageStore((state) => {
    for (let index = runIds.length - 1; index >= 0; index--) {
      const usage = state.byRun[runIds[index]];
      if (usage?.used) return usage;
    }
    return undefined;
  });
}
