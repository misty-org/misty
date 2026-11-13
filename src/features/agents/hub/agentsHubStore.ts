import { create } from "zustand";

/** The Agents window's pages: the person's agents, then what their engines' CLIs need. */
export type AgentsHubPage =
  | "agents"
  | "clis"
  | "channels"
  | "environment"
  | "usage"
  | "plugins"
  | "mcp"
  | "skills"
  | "prompts";

/**
 * Whether the Agents window is open, and on which page. The sidebar's Agents row, setup and the
 * tours open it; the window's layout draws it.
 */
export const useAgentsHub = create<{
  open: boolean;
  page: AgentsHubPage;
  show(page?: AgentsHubPage): void;
  setPage(page: AgentsHubPage): void;
  close(): void;
}>((set) => ({
  open: false,
  page: "agents",
  show: (page) => set((state) => ({ open: true, page: page ?? state.page })),
  setPage: (page) => set({ page }),
  close: () => set({ open: false }),
}));

/** Opens the Agents window, on `page` when given. */
export function openAgentsHub(page?: AgentsHubPage) {
  useAgentsHub.getState().show(page);
}
