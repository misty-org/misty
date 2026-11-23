import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import type { AiInvocationDeviceContext } from "../invocations";
import type { GlobalAiContextRef } from "../../conversations/state/conversation_types";
import { releaseLease } from "../jobs/execution_lease";
import { useMistyStore } from "../../conversations/state/use_misty_store";
import { replaceActiveGlobalInvocationStream } from "../../conversations/state/misty_store_updates";
import { aiSurfaceApi } from "../invocations/api";

export interface Execution {
  taskId: string;
  conversationId?: string;
  accountId: string;
  agentId: string;
  spaceId: string;
  state: "running" | "waiting" | "paused" | "finished";
  views: string[];
  childViews?: string[];
  autopilot?: boolean;
  desktopControl?: boolean;
  ready?: boolean;
  context: GlobalAiContextRef[];
  deviceContexts: AiInvocationDeviceContext[];
}
export const useLocalExecution = create<{ execution: Execution | null }>(() => ({
  execution: null,
}));

let heartbeat: ReturnType<typeof setInterval> | undefined;
let generation = 0;

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
  const stillCurrent =
    generation === epoch && useLocalExecution.getState().execution?.taskId === execution.taskId;
  const invocationId = stillCurrent ? useMistyStore.getState().invocationId : undefined;
  if (stillCurrent) {
    replaceActiveGlobalInvocationStream();
    useMistyStore.setState({ working: false, invocationId: undefined });
  }
  await releaseLease(execution);
  if (invocationId) {
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

export async function settleLocalExecution(
  state: "paused" | "finished" = "finished",
  expectedTaskId?: string,
) {
  const execution = useLocalExecution.getState().execution;
  if (!execution || (expectedTaskId && execution.taskId !== expectedTaskId)) return;
  nextExecutionGeneration();
  replaceExecutionHeartbeat();
  useLocalExecution.setState({ execution: { ...execution, state } });
  await releaseLease(execution);
}
