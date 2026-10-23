import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import type { AiInvocationDeviceContext } from "@/features/ai-surface";
import type { GlobalAiContextRef } from "@/features/misty/types";
import { releaseLease } from "./executionLease";

export interface Execution {
  taskId: string;
  conversationId?: string;
  accountId: string;
  agentId: string;
  spaceId: string;
  /** waiting: the run is suspended until the user acts. It keeps its lease and
   * screen, but input, the control ring and Misty's cursor go back to the user. */
  state: "running" | "waiting" | "paused" | "finished";
  views: string[];
  /** Tabs opened for this task's sub-agents; closed with the task. */
  childViews?: string[];
  autopilot?: boolean;
  desktopControl?: boolean;
  normalTabs?: boolean;
  ready?: boolean;
  context: GlobalAiContextRef[];
  deviceContexts: AiInvocationDeviceContext[];
  method?: {
    versionId: string;
    inputs?: Record<string, string | number | boolean>;
    skillVersionIds?: string[];
    invocationId?: string;
  };
}
export const useLocalExecution = create<{ execution: Execution | null }>(() => ({
  execution: null,
}));

let heartbeat: ReturnType<typeof setInterval> | undefined;
let generation = 0;

/** Each start, pause and settle fences the callbacks of the one before it. */
export const nextExecutionGeneration = () => ++generation;
export const executionGeneration = () => generation;

export function replaceExecutionHeartbeat(next?: ReturnType<typeof setInterval>) {
  clearInterval(heartbeat);
  heartbeat = next;
}

export async function pauseLocalExecution(expectedTaskId?: string) {
  const execution = useLocalExecution.getState().execution;
  if (!execution || (expectedTaskId && execution.taskId !== expectedTaskId)) return;
  const epoch = nextExecutionGeneration();
  replaceExecutionHeartbeat();
  useLocalExecution.setState({ execution: { ...execution, state: "paused" } });
  const { useMistyStore } = await import("@/features/misty/useMistyStore");
  const { replaceActiveGlobalInvocationStream } =
    await import("@/features/misty/mistyStoreHelpers");
  const stillCurrent =
    generation === epoch && useLocalExecution.getState().execution?.taskId === execution.taskId;
  const invocationId = stillCurrent ? useMistyStore.getState().invocationId : undefined;
  if (stillCurrent) {
    replaceActiveGlobalInvocationStream();
    useMistyStore.setState({ working: false, invocationId: undefined });
  }
  await releaseLease(execution);
  if (invocationId) {
    const { aiSurfaceApi } = await import("@/features/ai-surface/api");
    await aiSurfaceApi.cancelInvocation(invocationId).catch(() => {});
  }
}
export async function finishLocalExecution() {
  const execution = useLocalExecution.getState().execution;
  if (!execution) return;
  await pauseLocalExecution(execution.taskId);
  if (useLocalExecution.getState().execution?.taskId !== execution.taskId) return;
  useLocalExecution.setState({ execution: null });
  await Promise.allSettled(
    [...execution.views, ...(execution.childViews ?? [])].map((id) =>
      invoke("browser_webview_close", { request: { id } }),
    ),
  );
}

/** Quiesce only this task; a late completion must never release its successor. */
export async function settleLocalExecution(
  state: "paused" | "finished" = "finished",
  expectedTaskId?: string,
) {
  const execution = useLocalExecution.getState().execution;
  if (!execution || (expectedTaskId && execution.taskId !== expectedTaskId)) return;
  nextExecutionGeneration();
  replaceExecutionHeartbeat();
  // Publish the stopped state before awaiting release so a successor sees a quiesced task.
  useLocalExecution.setState({ execution: { ...execution, state } });
  await releaseLease(execution);
}
