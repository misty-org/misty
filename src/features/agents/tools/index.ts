import { watchAllRunEvents } from "../runs/local-run/local_run_events";
import { finishWithProposal } from "../runs/local-run/local_run_parts";
import { agentAccountId } from "../personal/agent_account";
import { agentTools } from "./agent_tools";
import { appsTools } from "./apps_tools";
import { cancelSubAgentsOf, delegationTools } from "./delegation_tools";
import { deviceTools } from "./device_tools";
import { registerLocalTools, type LocalToolHandler } from "./host";
import { runStateTools } from "./run_state_tools";
import { spaceTools } from "./space_tools";

const allLocalTools: Record<string, LocalToolHandler> = {
  ...deviceTools,
  ...runStateTools,
  ...appsTools,
  ...spaceTools,
  ...agentTools,
  ...delegationTools,
};

const ended = new Set(["invocation.completed", "invocation.failed", "invocation.canceled"]);

export function startLocalRunWork(): () => void {
  registerLocalTools(allLocalTools);
  const stop = watchAllRunEvents((runId, event) => {
    if (event.type === "local.artifact_answer")
      void finishWithProposal(runId, event.text, agentAccountId());
    if (ended.has(event.type)) void cancelSubAgentsOf(runId).catch(() => undefined);
  });
  return stop;
}
