import { create } from "zustand";
import { useSpaceWindowStore } from "@/features/app-windows";
import { invoke } from "@/native/invoke";
import type { AgentProfile } from "@/shared/schemas";
import { listPersonalAgents, newEngineAgents, personalAgentsApi } from "./personalAgentsApi";

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

/** The first new engine agent whose CLI says it is signed in; one whose CLI can't say comes next,
 * and one signed out is never picked. */
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
    // Only a first load with nothing known is loading: a refresh keeps the agents on screen,
    // and on launch the saved list paints while the agents are listed again.
    set({ loading: !get().agents.length });
    const showSaved = ({ agents }: { agents: AgentProfile[] }) => {
      if (get().accountId !== accountId || get().agents.length || !agents.length) return;
      set({ agents, loading: false });
    };
    try {
      const { agents } = await personalAgentsApi.list(showSaved);
      if (revision === request && get().accountId === accountId) {
        set({ agents, loading: false, error: "" });
        // The first time the person's own engines are found, new chats start with one that is
        // installed and signed in, as its CLI says.
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
// Agents with no home Space yet get the person's own once this account's Spaces load: listing them
// again saves it (`placeUnplacedAgents`).
useSpaceWindowStore.subscribe((state, previous) => {
  if (
    state.personalSpaceOwner === previous.personalSpaceOwner &&
    state.personalSpaceId === previous.personalSpaceId
  )
    return;
  const { accountId, agents, load } = usePersonalAgentsStore.getState();
  if (!accountId || state.personalSpaceOwner !== accountId) return;
  if (agents.some((agent) => !agent.space_id)) void load(accountId);
});

export function selectedPersonalAgent(_spaceId: string) {
  const state = usePersonalAgentsStore.getState();
  return (
    state.agents.find((a) => a.id === state.selected.global && a.enabled && !a.system_managed) ??
    // Misty's own runtime is never the default; it is the last resort when no engine agent exists.
    state.agents.find((a) => a.engine && a.enabled) ??
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
