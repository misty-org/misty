import { useEffect } from "react";
import { create } from "zustand";
import { invoke } from "@/native/invoke";
import type { AgentProfile } from "@/shared/schemas";
import { mistyEngine } from "../engines/enginesApi";
import { agentAccountId } from "../personal/agentAccount";

/**
 * Each agent's one folder on this computer, where every chat with it works on an outside engine.
 * Native code keeps and decides it (`engines/agent_folder.rs`): the person picks it in the
 * system's dialog or Misty makes a new one under Documents/Misty. `null` means it has none yet;
 * its first run takes the Space's folder or gets a new one.
 */
interface AgentFoldersState {
  byAgent: Record<string, string | null>;
  load(agentId: string): Promise<string | null>;
  choose(agentId: string): Promise<string | null>;
  makeNew(agentId: string, name: string): Promise<string>;
  /** Reads it again, after a run may have given the agent its first folder. */
  refresh(agentId: string): void;
}

export const useAgentFolders = create<AgentFoldersState>((set, get) => {
  const keep = (agentId: string, path: string | null) =>
    set({ byAgent: { ...get().byAgent, [agentId]: path } });
  return {
    byAgent: {},
    async load(agentId) {
      const path = await invoke<string | null>("agent_folder", {
        account: agentAccountId(),
        agent: agentId,
      });
      keep(agentId, path ?? null);
      return path ?? null;
    },
    async choose(agentId) {
      const path = await invoke<string | null>("agent_folder_choose", {
        account: agentAccountId(),
        agent: agentId,
      });
      if (path) keep(agentId, path);
      return path ?? null;
    },
    async makeNew(agentId, name) {
      const path = await invoke<string>("agent_folder_new", {
        account: agentAccountId(),
        agent: agentId,
        name,
      });
      keep(agentId, path);
      return path;
    },
    refresh(agentId) {
      void get()
        .load(agentId)
        .catch(() => undefined);
    },
  };
});

/** Whether an agent works through an outside engine, and so in a folder of its own. */
export const worksInFolder = (agent?: Pick<AgentProfile, "engine">) =>
  Boolean(agent?.engine && agent.engine !== mistyEngine);

/**
 * The agent's folder, loaded on first use: `undefined` while it is read, `null` when it has none
 * yet. Agents on Misty's own runtime have no folder of their own.
 */
export function useAgentFolder(
  agent?: Pick<AgentProfile, "id" | "engine">,
): string | null | undefined {
  const id = agent && worksInFolder(agent) ? agent.id : "";
  const folder = useAgentFolders((state) => (id ? state.byAgent[id] : null));
  useEffect(() => {
    if (id && useAgentFolders.getState().byAgent[id] === undefined)
      void useAgentFolders
        .getState()
        .load(id)
        .catch(() => undefined);
  }, [id]);
  return folder;
}
