import { invoke } from "@tauri-apps/api/core";
import type { Execution } from "../local-execution/localExecution";

/** Gives up native code's hold on a task's window. Only it decides who holds one. */
export const releaseLease = async (e: Execution) => {
  await Promise.allSettled([invoke("agent_workspace_release", { taskId: e.taskId })]);
};

/** The native workspace's view of a task's authority. */
export const lease = (execution: Execution) => ({
  accountId: execution.accountId,
  agentId: execution.agentId,
  spaceId: execution.spaceId,
  taskId: execution.taskId,
});
