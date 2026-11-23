import { create } from "zustand";
import { useSpaceWindowStore } from "@/features/app-windows";
import { invoke } from "@/native/invoke";
import type { AgentProfile } from "@/shared/schemas";
import { useSettingsStore } from "@/features/settings";
import { listPersonalAgents, newEngineAgents, personalAgentsApi } from "./personal_agents_api";
import { refreshSpaceAgents } from "./space_agent_sync";
import { agentAccountId } from "./agent_account";

export const spaceAgentsChangedEvent = "misty:space-agents-changed";

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

async function signedInStarter(fresh: AgentProfile[]): Promise<AgentProfile | undefined> {
  const answers = await Promise.all(
    fresh.map((agent) =>
      invoke<{ signedIn: boolean | null }>("engine_cli_signed_in", { engine: agent.engine })
        .then((status) => status.signedIn)
        .catch(() => null),
    ),
  );
  return fresh[answers.indexOf(true)] ?? fresh[answers.indexOf(null)];
}
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
    set({ loading: !get().agents.length });
    const showSaved = ({ agents }: { agents: AgentProfile[] }) => {
      if (get().accountId !== accountId || get().agents.length || !agents.length) return;
      set({ agents, loading: false });
    };
    try {
      const { agents } = await personalAgentsApi.list(showSaved);
      if (revision === request && get().accountId === accountId) {
        set({ agents, loading: false, error: "" });
        const fresh = newEngineAgents;
        if (!get().selected.global && fresh.length) {
          void signedInStarter(fresh).then((starter) => {
            if (starter && get().accountId === accountId && !get().selected.global)
              set({ selected: { global: starter.id } });
          });
        }
      }
    } catch (error) {
      if (revision === request && get().accountId === accountId)
        set({ loading: false, error: error instanceof Error ? error.message : String(error) });
    }
  },
  select(_spaceId, agentId) {
    set({ selected: { global: agentId } });
  },
}));
useSpaceWindowStore.subscribe((state, previous) => {
  if (
    state.personalSpaceOwner === previous.personalSpaceOwner &&
    state.personalSpaceId === previous.personalSpaceId
  )
    return;
  const { accountId, agents, load } = usePersonalAgentsStore.getState();
  if (!accountId || state.personalSpaceOwner !== accountId) return;
  if (agents.some((agent) => !agent.space_id || (!agent.revision && !agent.system_managed)))
    void load(accountId);
});

if (typeof window !== "undefined")
  window.addEventListener(spaceAgentsChangedEvent, (event) => {
    const spaceId = (event as CustomEvent<{ spaceId?: string }>).detail?.spaceId;
    const { accountId } = usePersonalAgentsStore.getState();
    if (!spaceId || !accountId) return;
    void refreshSpaceAgents(accountId, spaceId)
      .then((agents) => {
        if (agents && usePersonalAgentsStore.getState().accountId === accountId)
          usePersonalAgentsStore.setState({ agents });
      })
      .catch(() => undefined);
  });

const mineFirst = (agents: readonly AgentProfile[]) => {
  const account = agentAccountId();
  const mine = agents.filter((agent) => !agent.owner_user_id || agent.owner_user_id === account);
  return mine.length ? mine : agents;
};

export function defaultAgentOf(all: readonly AgentProfile[]): AgentProfile | undefined {
  const agents = mineFirst(all);
  const document = useSettingsStore.getState().settings?.document as
    Record<string, Record<string, unknown> | undefined> | undefined;
  const engine = String(document?.agent?.default_engine ?? "");
  return (
    agents.find((a) => engine && a.id === `personal_engine_${engine}` && a.enabled) ??
    agents.find((a) => engine && a.engine === engine && a.enabled) ??
    agents.find((a) => a.engine && a.engine !== "misty" && a.enabled && !a.system_managed) ??
    agents.find((a) => a.system_managed)
  );
}

export function selectedPersonalAgent(_spaceId: string) {
  const state = usePersonalAgentsStore.getState();
  return (
    state.agents.find((a) => a.id === state.selected.global && a.enabled && !a.system_managed) ??
    defaultAgentOf(state.agents)
  );
}

export async function personalAgentFor(account: string, agentId: string) {
  if (!agentId) return null;
  const known = usePersonalAgentsStore.getState();
  const agents =
    known.accountId === account && known.agents.length
      ? known.agents
      : await listPersonalAgents(account);
  return agents.find((agent) => agent.id === agentId) ?? null;
}
