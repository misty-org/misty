import { invoke } from "@tauri-apps/api/core";
import { hasTauriInternals } from "@/shared/platform/tauri";
import { isAgentWorkerWindow, useLocalExecution } from "./localExecution";

/**
 * A follow-up to a run that handed off (its question or app card was answered
 * after it ended) continues on the screen that run held, not a fresh one.
 */
export function continuationScreen(
  conversationId: string,
): { executionMode: "agent" | "team"; openScreen?: { tabId: string } } | undefined {
  const execution = useLocalExecution.getState().execution;
  if (
    !conversationId ||
    !execution?.ready ||
    execution.conversationId !== conversationId ||
    execution.state === "running" ||
    execution.state === "waiting"
  )
    return undefined;
  if (execution.normalTabs) {
    const tabId = execution.context.find((ref) => ref.kind === "browser-tab")?.id;
    return tabId ? { executionMode: execution.mode, openScreen: { tabId } } : undefined;
  }
  if (execution.desktopControl) return { executionMode: "agent" };
  // The agent window keeps its own browser views for the next run.
  if (isAgentWorkerWindow()) return { executionMode: execution.mode };
  return undefined;
}

/**
 * The run is waiting for the user (a sign-in, a challenge, a review). Keep the
 * lease alive so the run resumes on the same screen, but give control back.
 */
export async function awaitUserForExecution(expectedTaskId: string) {
  const execution = useLocalExecution.getState().execution;
  if (execution?.taskId !== expectedTaskId || execution.state !== "running") return;
  useLocalExecution.setState({ execution: { ...execution, state: "waiting" } });
  await yieldControl(execution.taskId, true);
}

/** The user finished (or declined) what the run waited for; it acts again. */
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
