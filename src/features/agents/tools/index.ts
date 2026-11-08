import { watchAllRunEvents } from "../runs/local-run/localRunEvents";
import { finishWithProposal } from "../runs/local-run/localRunParts";
import { agentAccountId } from "../personal/agentAccount";
import { agentTools } from "./agentTools";
import { appsTools } from "./appsTools";
import { cancelSubAgentsOf, delegationTools } from "./delegationTools";
import { deviceTools } from "./deviceTools";
import { registerLocalTools, type LocalToolHandler } from "./host";
import { memoryTools } from "./memoryTools";
import { runStateTools } from "./runStateTools";
import { spaceTools } from "./spaceTools";
import { workflowTools } from "./workflowTools";

/**
 * Every tool a run can call, in one place: the same list as `LOCAL_TOOLS` in
 * src-tauri/features/agents/runs/local_tools.rs. Native code journals them, decides which stop for
 * the person (`tool_policy.rs`), and only then asks this window to do the work. The server checks a
 * Space change after that like any request of theirs.
 */

export const allLocalTools: Record<string, LocalToolHandler> = {
  ...deviceTools,
  ...runStateTools,
  ...memoryTools,
  ...appsTools,
  ...workflowTools,
  ...spaceTools,
  ...agentTools,
  ...delegationTools,
};

const ended = new Set(["invocation.completed", "invocation.failed", "invocation.canceled"]);

/** Starts what the window running tools owes every run. Returns how to stop. */
export function startLocalRunWork(): () => void {
  registerLocalTools(allLocalTools);
  const stop = watchAllRunEvents((runId, event) => {
    if (event.type === "local.artifact_answer")
      void finishWithProposal(runId, event.text, agentAccountId());
    if (ended.has(event.type)) void cancelSubAgentsOf(runId).catch(() => undefined);
  });
  return stop;
}
