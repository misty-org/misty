import { invoke } from "@tauri-apps/api/core";
import { hasTauriInternals } from "@/shared/platform/tauri";
import { useLocalExecution } from "../local-execution/local_execution";

export function continuationScreen(conversationId: string): { executionMode: "agent" } | undefined {
  const execution = useLocalExecution.getState().execution;
  if (
    !conversationId ||
    !execution?.ready ||
    execution.conversationId !== conversationId ||
    execution.state === "running" ||
    execution.state === "waiting"
  )
    return undefined;
  if (execution.desktopControl) return { executionMode: "agent" };
  return undefined;
}

export async function awaitUserForExecution(expectedTaskId: string) {
  const execution = useLocalExecution.getState().execution;
  if (execution?.taskId !== expectedTaskId || execution.state !== "running") return;
  useLocalExecution.setState({ execution: { ...execution, state: "waiting" } });
  await yieldControl(execution.taskId, true);
}

export async function resumeExecutionAfterWait(expectedTaskId: string) {
  const execution = useLocalExecution.getState().execution;
  if (execution?.taskId !== expectedTaskId || execution.state !== "waiting") return;
  useLocalExecution.setState({ execution: { ...execution, state: "running" } });
  await yieldControl(execution.taskId, false);
}

async function yieldControl(taskId: string, yielded: boolean) {
  if (!hasTauriInternals()) return;
  await invoke("agent_control_yield", { taskId, yielded }).catch(() => undefined);
}
