import { deviceMemory } from "@/api/runtime/device-memory";
import { localRunActivity } from "@/features/agents/localRun";
import { invoke } from "@/native/invoke";
import type {
  AgentNotebook,
  AgentSubagent,
  AiArtifact,
  AiCitation,
  AiInvocationCreated,
  AiInvocationRequest,
  AiProgressItem,
} from "./invocationTypes";
import type { MistyActivityEntry } from "../../conversations/state/activity";

export * from "./aiSettingsTypes";
export { subscribeToAiInvocation } from "./invocationSubscription";
import type { AiMemoryRecord, ScreenLocation } from "./aiSettingsTypes";
import { changeAgentSettings, readAgentSettings } from "./localAiSettings";
import { completeLocalArtifact, decideLocalArtifact } from "../local-run/artifacts";
import { localRunProgress, localRunState } from "../local-run/runState";
import { startLocalRun } from "../local-run/startRun";

export const aiSurfaceApi = {
  settings: async () => ({ settings: await readAgentSettings() }),
  updateSettings: (enabled: boolean, retentionDays: number, memoryEnabled?: boolean) =>
    changeAgentSettings({
      enabled,
      retention_days: retentionDays,
      ...(memoryEnabled === undefined ? {} : { memory_enabled: memoryEnabled }),
    }),
  updateScreenLocation: (location: ScreenLocation) =>
    changeAgentSettings({ screen_location: location }),
  updateAgentSites: (change: { block_sensitive?: boolean; blocked_sites?: string[] }) =>
    changeAgentSettings({
      ...(change.block_sensitive === undefined
        ? {}
        : { agent_block_sensitive: change.block_sensitive }),
      ...(change.blocked_sites === undefined ? {} : { agent_blocked_sites: change.blocked_sites }),
    }),
  /** Whether agents stop to ask before paying or buying (`payments_ask`). */
  updatePaymentsAsk: (paymentsAsk: boolean) => changeAgentSettings({ payments_ask: paymentsAsk }),
  updateKeepAwake: (keepAwake: boolean) =>
    changeAgentSettings({ keep_awake_for_agents: keepAwake }),
  memories: async (): Promise<{ memories: AiMemoryRecord[] }> => ({
    memories: await deviceMemory.prefs({ space_id: "", agent_id: "" }),
  }),
  forgetMemory: (memoryId: string) =>
    deviceMemory.forgetPref({ space_id: "", agent_id: "", id: memoryId }),
  activity: async (
    _spaceId: string,
    agentId?: string,
  ): Promise<{ entries: MistyActivityEntry[] }> => ({
    entries: await localRunActivity(agentId),
  }),
  createInvocation: (input: AiInvocationRequest): Promise<AiInvocationCreated> =>
    startLocalRun(input),
  /** How a reply got its answer: notes and tool runs, rebuilt from what its run kept. */
  invocationProgress: (
    invocationId: string,
  ): Promise<{
    items: AiProgressItem[];
    citations?: AiCitation[];
    notebook?: AgentNotebook;
    subagents?: AgentSubagent[];
  }> => localRunProgress(invocationId),
  /** The run's state: running, completed, failed, canceled, or missing when nothing knows of it. */
  invocationState: (invocationId: string) => localRunState(invocationId),
  cancelInvocation: async (invocationId: string) => {
    await invoke("agent_run_cancel", { runId: invocationId });
    const { cancelSubAgentsOf } = await import("@/features/agents/tools/delegationTools");
    await cancelSubAgentsOf(invocationId).catch(() => undefined);
    return { state: "canceled" };
  },
  /** Take over: the run waits at its next step until resumed (an agent's window). */
  pauseInvocation: async (invocationId: string) => {
    await invoke("agent_run_pause", { runId: invocationId, paused: true });
    return { state: "paused" };
  },
  resumeInvocation: async (invocationId: string) => {
    await invoke("agent_run_pause", { runId: invocationId, paused: false });
    return { state: "running" };
  },
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
