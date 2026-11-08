import { create } from "zustand";
import type { AgentProfile } from "@/shared/schemas";
import { listPersonalAgents, personalAgentsApi } from "./personalAgentsApi";

interface PersonalAgentsState {
  accountId: string;
  agents: AgentProfile[];
  selected: Record<string, string>;
  loading: boolean;
  error: string;
  load(accountId: string): Promise<void>;
  select(spaceId: string, agentId: string): void;
}
let revision = 0;
export const usePersonalAgentsStore = create<PersonalAgentsState>((set, get) => ({
  accountId: "",
  agents: [],
  selected: {},
  loading: false,
  error: "",
  async load(accountId) {
    const request = ++revision;
    if (get().accountId !== accountId) set({ accountId, agents: [], selected: {}, error: "" });
    if (!accountId) {
      set({ loading: false });
      return;
    }
    set({ loading: true });
    try {
      const { agents } = await personalAgentsApi.list();
      if (revision === request && get().accountId === accountId)
        set({ agents, loading: false, error: "" });
    } catch (error) {
      if (revision === request && get().accountId === accountId)
        set({ loading: false, error: error instanceof Error ? error.message : String(error) });
    }
  },
  select(_spaceId, agentId) {
    set({ selected: { global: agentId } });
  },
}));
export function selectedPersonalAgent(_spaceId: string) {
  const state = usePersonalAgentsStore.getState();
  return (
    state.agents.find((a) => a.id === state.selected.global && a.enabled) ??
    state.agents.find((a) => a.system_managed)
  );
}

/** The agent a run works as, from the account's own list. Null when it names none we know. */
export async function personalAgentFor(account: string, agentId: string) {
  if (!agentId) return null;
  const known = usePersonalAgentsStore.getState();
  const agents =
    known.accountId === account && known.agents.length
      ? known.agents
      : await listPersonalAgents(account);
  return agents.find((agent) => agent.id === agentId) ?? null;
}
