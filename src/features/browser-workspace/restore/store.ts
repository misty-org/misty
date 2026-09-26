import { create } from "zustand";

export type RestoreStatus = "restoring" | "restored" | "partial" | "failed";

export interface TabRestore {
  tabId: string;
  title: string;
  status: RestoreStatus;
  /** Fields still not filled; secrets always need the user. */
  remaining: number;
  secrets: number;
  agentUsed: boolean;
}

export const usePageRestoreStore = create<{
  tabs: Record<string, TabRestore>;
  set: (tab: TabRestore) => void;
  clear: () => void;
}>((set) => ({
  tabs: {},
  set: (tab) => set((state) => ({ tabs: { ...state.tabs, [tab.tabId]: tab } })),
  clear: () => set({ tabs: {} }),
}));
