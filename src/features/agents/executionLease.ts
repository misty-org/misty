import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { apiRequest } from "@/api/client";
import type { Execution } from "./localExecution";

/** Claims (or renews) server authority for a task in this window. */
export const remoteLease = (e: Execution, renew = false) =>
  apiRequest("/misty/agent-execution", {
    method: "POST",
    body: JSON.stringify({
      agent_id: e.agentId,
      space_id: e.spaceId,
      task_id: e.taskId,
      window_label: getCurrentWindow().label,
      renew,
    }),
  });

export const releaseLease = async (e: Execution) => {
  // Attempt both boundaries even when connectivity is lost. Server authority expires independently.
  await Promise.allSettled([
    invoke("agent_workspace_release", { taskId: e.taskId }),
    apiRequest(`/misty/agent-execution/${encodeURIComponent(e.taskId)}`, { method: "DELETE" }),
  ]);
};

/** The native workspace's view of a task's authority. */
export const lease = (execution: Execution) => ({
  accountId: execution.accountId,
  agentId: execution.agentId,
  spaceId: execution.spaceId,
  taskId: execution.taskId,
});
