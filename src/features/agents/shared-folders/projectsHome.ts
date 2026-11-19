import { useEffect } from "react";
import { create } from "zustand";
import { useUserStore } from "@/features/account/core";
import { invoke } from "@/native/invoke";
import { agentAccountId, useAgentAccountId } from "../personal/agentAccount";

/**
 * The folder new projects go in on this computer, chosen in the system's dialog during setup and
 * changeable in Settings. "Open in Code" makes a chat's project inside it
 * (`engines/open_in_code.rs`). Misty suggests no place: the person picks one.
 */
interface ProjectsHomeState {
  /** The folder, "" while none is chosen, or null before the first read. */
  path: string | null;
  load(): Promise<string>;
  /** Opens the system's dialog on the home folder. The chosen folder, or null if cancelled. */
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

/** Signed out or switched account: the next read is that account's. */
let shownAccount = agentAccountId();
useUserStore.subscribe(() => {
  if (agentAccountId() === shownAccount) return;
  shownAccount = agentAccountId();
  useProjectsHome.setState({ path: null });
});

/** The projects folder, read on first use: "" while none is chosen, null before the read. */
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
