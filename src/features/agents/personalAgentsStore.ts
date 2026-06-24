import { create } from "zustand";
import type { AgentProfile } from "@misty/contracts";
import { personalAgentsApi } from "@/api/agents/native";

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
  select(spaceId, agentId) {
    set({ selected: { ...get().selected, [spaceId]: agentId } });
  },
}));
export function selectedPersonalAgent(spaceId: string) {
  const state = usePersonalAgentsStore.getState();
  return (
    state.agents.find((a) => a.id === state.selected[spaceId] && a.enabled) ??
    state.agents.find((a) => a.system_managed)
  );
}
