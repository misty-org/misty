import { useEffect } from "react";
import { create } from "zustand";
import { useUserStore } from "@/features/account/core";
import { invoke } from "@/native/invoke";
import { agentAccountId, useAgentAccountId } from "../personal/agent_account";

interface ProjectsHomeState {
  path: string | null;
  load(): Promise<string>;
  choose(): Promise<string | null>;
}

const account = () => agentAccountId();

export const useProjectsHome = create<ProjectsHomeState>((set) => ({
  path: null,
  async load() {
    const path = (await invoke<string | null>("projects_home", { account: account() })) ?? "";
    set({ path });
    return path;
  },
  async choose() {
    const path = await invoke<string | null>("projects_home_choose", { account: account() });
    if (path) set({ path });
    return path ?? null;
  },
}));

let shownAccount = agentAccountId();
useUserStore.subscribe(() => {
  if (agentAccountId() === shownAccount) return;
  shownAccount = agentAccountId();
  useProjectsHome.setState({ path: null });
});

export function useProjectsHomePath(): string | null {
  const accountId = useAgentAccountId();
  const path = useProjectsHome((state) => state.path);
  useEffect(() => {
    if (accountId && useProjectsHome.getState().path === null)
      void useProjectsHome
        .getState()
        .load()
        .catch(() => undefined);
  }, [accountId]);
  return path;
}
