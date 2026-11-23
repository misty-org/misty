import { localRunActivity } from "@/features/agents/local_run";
import { invoke } from "@/native/invoke";
import type {
  AgentNotebook,
  AgentSubagent,
  AiArtifact,
  AiCitation,
  AiInvocationCreated,
  AiInvocationRequest,
  AiProgressItem,
} from "./invocation_types";
import type { MistyActivityEntry } from "../../conversations/state/activity";

export * from "./ai_settings_types";
export { subscribeToAiInvocation } from "./invocation_subscription";
import type { ScreenLocation } from "./ai_settings_types";
import { changeAgentSettings, readAgentSettings } from "./local_ai_settings";
import { completeLocalArtifact, decideLocalArtifact } from "../local-run/artifacts";
import { localRunProgress, localRunState } from "../local-run/run_state";
import { startLocalRun } from "../local-run/start_run";

export const aiSurfaceApi = {
  settings: async () => ({ settings: await readAgentSettings() }),
  updateScreenLocation: (location: ScreenLocation) =>
    changeAgentSettings({ screen_location: location }),
  updateAgentSites: (change: { block_sensitive?: boolean; blocked_sites?: string[] }) =>
    changeAgentSettings({
      ...(change.block_sensitive === undefined
        ? {}
        : { agent_block_sensitive: change.block_sensitive }),
      ...(change.blocked_sites === undefined ? {} : { agent_blocked_sites: change.blocked_sites }),
    }),
  updatePaymentsAsk: (paymentsAsk: boolean) => changeAgentSettings({ payments_ask: paymentsAsk }),
  updateKeepAwake: (keepAwake: boolean) =>
    changeAgentSettings({ keep_awake_for_agents: keepAwake }),
  activity: async (
    _spaceId: string,
    agentId?: string,
  ): Promise<{ entries: MistyActivityEntry[] }> => ({
    entries: await localRunActivity(agentId),
  }),
  createInvocation: (input: AiInvocationRequest): Promise<AiInvocationCreated> =>
    startLocalRun(input),
  invocationProgress: (
    invocationId: string,
  ): Promise<{
    items: AiProgressItem[];
    citations?: AiCitation[];
    notebook?: AgentNotebook;
    subagents?: AgentSubagent[];
  }> => localRunProgress(invocationId),
  invocationState: (invocationId: string) => localRunState(invocationId),
  cancelInvocation: async (invocationId: string) => {
    await invoke("agent_run_cancel", { runId: invocationId });
    const { cancelSubAgentsOf } = await import("@/features/agents/tools/delegation_tools");
    await cancelSubAgentsOf(invocationId).catch(() => undefined);
    return { state: "canceled" };
  },
  pauseInvocation: (invocationId: string) =>
    invoke<boolean>("agent_run_pause", { runId: invocationId, paused: true }),
  resumeInvocation: (invocationId: string) =>
    invoke<boolean>("agent_run_pause", { runId: invocationId, paused: false }),
  decideArtifact: (
    artifactId: string,
    decision: "accept" | "reject" | "refine",
    _idempotencyKey: string,
    _operations?: unknown,
    _refinement?: string,
  ): Promise<{ artifact: AiArtifact; applyMode?: "server" | "client"; result?: unknown }> =>
    decideLocalArtifact(artifactId, decision),
  completeArtifact: (artifactId: string, state: "applied" | "failed", error?: string) =>
    completeLocalArtifact(artifactId, state, error),
};
