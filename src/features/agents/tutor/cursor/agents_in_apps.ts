import { create } from "zustand";

interface AgentsInApps {
  working: Record<string, string | undefined>;
}

export const useAgentsInApps = create<AgentsInApps>(() => ({ working: {} }));

export function showAgentInApp(instance: string, agentId: string | undefined) {
  useAgentsInApps.setState((state) =>
    state.working[instance] === agentId
      ? state
      : { working: { ...state.working, [instance]: agentId } },
  );
}

export const agentInAnApp = (agentId: string | undefined) =>
  Boolean(agentId) &&
  Object.values(useAgentsInApps.getState().working).some((working) => working === agentId);
