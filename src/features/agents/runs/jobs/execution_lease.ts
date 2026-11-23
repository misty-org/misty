import { invoke } from "@tauri-apps/api/core";
import type { Execution } from "../local-execution/local_execution_state";

export const releaseLease = async (e: Execution) => {
  await Promise.allSettled([invoke("agent_workspace_release", { taskId: e.taskId })]);
};

export const lease = (execution: Execution) => ({
  accountId: execution.accountId,
  agentId: execution.agentId,
  spaceId: execution.spaceId,
  taskId: execution.taskId,
});
