import { usePersonalAgentsStore } from "@/features/agents";
import {
  allLayoutViews,
  blankBrowserUrl,
  browserHomeUrl,
  browserNewTabUrl,
  parseBrowserViewState,
  useWorkspaceStore,
  workspaceSurfaceFromRoute,
  type WorkspaceView,
} from "@/features/app-windows";

/**
 * Closes the web pages a person left open, which the window saved before it stopped showing
 * tabs. Pages an agent opened for itself are kept. Run once as a window opens: an agent at work
 * may open an ordinary page too, and that one must stay.
 */
export function closeSavedWebPages(): string[] {
  const addresses: string[] = [];
  for (const view of allLayoutViews(useWorkspaceStore.getState().layout)) {
    if (view.surfaceId !== "browser") continue;
    const page = parseBrowserViewState(view.state);
    if (page.agentOwned) continue;
    useWorkspaceStore.getState().closeView(view.id);
    if (!view.placeholder) addresses.push(page.url);
  }
  return addresses;
}

/**
 * Keeps web pages out of the window's panes while it is open. Whatever still asks for one (an
 * old menu row, a Memory link) has its page closed at once and its address handed to the
 * person's own browser. Agents never come this way: their pages are their own, beside the chat.
 */
export function watchForWebPages(onClosed: () => void, openOutside: (url: string) => void) {
  let closing = false;
  return useWorkspaceStore.subscribe((state, previous) => {
    if (closing || state.layout === previous.layout) return;
    closing = true;
    try {
      const addresses = closeSavedWebPages();
      const resting = new Set([blankBrowserUrl, browserHomeUrl(), browserNewTabUrl()]);
      for (const url of addresses)
        if (/^https?:\/\//i.test(url) && !resting.has(url)) openOutside(url);
      if (addresses.length) onClosed();
    } finally {
      closing = false;
    }
  });
}

/** Opens one of the window's own pages (a Space section or an agent's chat) in the focused pane. */
export function openWorkspaceRoute(route: string, onOpen: (view: WorkspaceView) => void) {
  const surface = workspaceSurfaceFromRoute(route);
  if (!surface) return;
  const workspace = useWorkspaceStore.getState();
  const view = workspace.openDestination(surface);
  if (view.route !== route) workspace.updateViewRoute(view.id, route, true);
  onOpen({ ...view, route });
}

/** The route of an agent's chat: one conversation, or with `fresh` a new one. */
export function agentChatRoute(agentId: string, conversationId?: string, fresh = false) {
  const params = new URLSearchParams({ agent: agentId });
  if (conversationId) params.set("conversation", conversationId);
  // A new value each time, so asking twice in a row starts a second new chat.
  if (fresh) params.set("new", String(Date.now()));
  return `/agents?${params}`;
}

/** Starts a new chat with the agent last used here, or Misty's own. */
export function openNewChat(onOpen: (view: WorkspaceView) => void) {
  const { agents, selected } = usePersonalAgentsStore.getState();
  const agent =
    agents.find((item) => item.id === selected.global && item.enabled) ??
    agents.find((item) => item.system_managed) ??
    agents[0];
  openWorkspaceRoute(agent ? agentChatRoute(agent.id, undefined, true) : "/agents", onOpen);
}
