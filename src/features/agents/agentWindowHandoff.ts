import { invoke } from "@tauri-apps/api/core";
import type { AgentWindowTask } from "./AgentWorkerRoot";

export interface AgentWindowReceipt {
  invocationId?: string;
  eventsUrl?: string;
  taskId?: string;
  error?: string;
}
interface Handoff {
  accountId: string;
  agentId: string;
  queueId: string;
}
let active: Handoff | undefined;

async function nativeHandoff<T>(command: string, args: Record<string, unknown>): Promise<T> {
  try {
    return await invoke<T>(command, args);
  } catch (error) {
    const detail =
      error instanceof Error
        ? error.message
        : typeof error === "string"
          ? error
          : "Native handoff unavailable";
    throw new Error(`Agent window: ${detail.slice(0, 600)}`);
  }
}

export async function openAgentWindow(
  task: AgentWindowTask,
  name: string,
  assertCurrent: () => void,
): Promise<Required<Pick<AgentWindowReceipt, "invocationId" | "eventsUrl">>> {
  const owner = { accountId: task.accountId, agentId: task.agentId, queueId: task.queueId };
  active = owner;
  await nativeHandoff("agent_window_open", { request: { ...owner, spaceId: "", name, task } });
  // This observes a native admission receipt. It never resubmits business work.
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    assertCurrent();
    if (active !== owner) throw new Error("The separate-window task was stopped.");
    const receipt = await nativeHandoff<AgentWindowReceipt | null>(
      "agent_window_task_receipt",
      owner,
    );
    assertCurrent();
    if (receipt?.error) throw new Error(receipt.error);
    if (receipt?.invocationId && receipt.eventsUrl)
      return { invocationId: receipt.invocationId, eventsUrl: receipt.eventsUrl };
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(
    "The agent window has not acknowledged this task. Open it to review before retrying; this request will not be automatically repeated.",
  );
}

export async function stopAgentWindowTask() {
  const owner = active;
  active = undefined;
  if (owner) await nativeHandoff("agent_window_task_receipt", { ...owner, revoke: true });
}

/** Focus changes are reserved for the user's explicit Show agent window action. */
export async function showAgentWindow(accountId: string, agentId: string) {
  await nativeHandoff("agent_window_show", { accountId, agentId });
}
