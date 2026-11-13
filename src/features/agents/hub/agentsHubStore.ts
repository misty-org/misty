import { create } from "zustand";
import { createDeviceSetting } from "@/shared/lib/deviceSetting";

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

const hubPages: AgentsHubPage[] = [
  "agents",
  "clis",
  "channels",
  "environment",
  "usage",
  "plugins",
  "mcp",
  "skills",
  "prompts",
];

/** The page last shown, kept for the device in misty.db; the window itself always starts closed. */
const savedPage = createDeviceSetting<AgentsHubPage>({
  scope: "agents-hub-page",
  defaults: "agents",
  normalize: (stored) => hubPages.find((page) => page === stored) ?? "agents",
});

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
  page: savedPage.getState().value,
  show: (page) => {
    set((state) => ({ open: true, page: page ?? state.page }));
    if (page) savedPage.getState().set(page);
  },
  setPage: (page) => {
    set({ page });
    savedPage.getState().set(page);
  },
  close: () => set({ open: false }),
}));

// misty.db answers after the first frame; until the window opens, follow it.
savedPage.subscribe((state) => {
  if (state.loaded && !useAgentsHub.getState().open) useAgentsHub.setState({ page: state.value });
});

/** Opens the Agents window, on `page` when given. */
export function openAgentsHub(page?: AgentsHubPage) {
  useAgentsHub.getState().show(page);
}
