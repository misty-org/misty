import { create } from "zustand";
import { watchAllRunEvents } from "../../../runs/local-run/local_run_events";

export interface ContextUsage {
  used?: number;
  window?: number;
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

export function watchContextUsage() {
  if (watching) return;
  watching = true;
  try {
    watchAllRunEvents(keepUsage);
  } catch {
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

export function useChatContextUsage(runIds: string[]): ContextUsage | undefined {
  return useContextUsageStore((state) => {
    for (let index = runIds.length - 1; index >= 0; index--) {
      const usage = state.byRun[runIds[index]];
      if (usage?.used === 0) return undefined;
      if (usage?.used) return usage;
    }
    return undefined;
  });
}
