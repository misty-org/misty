import {
  defaultAgentOf,
  isProjectChat,
  openCodeChat,
  usePersonalAgentsStore,
} from "@/features/agents";
import {
  useWorkspaceStore,
  workspaceSurfaceFromRoute,
  type DockDropZone,
  type WorkspaceView,
} from "@/features/app-windows";

/** Opens one of the window's own pages (a Space section or an agent's chat) in the focused pane. */
export function openWorkspaceRoute(route: string, onOpen: (view: WorkspaceView) => void) {
  const surface = workspaceSurfaceFromRoute(route);
  if (!surface) return;
  const workspace = useWorkspaceStore.getState();
  const view = workspace.openDestination(surface);
  if (view.route !== route) workspace.updateViewRoute(view.id, route, true);
  onOpen({ ...view, route });
}

/** Where "Open in" puts a page: a tab of its own, or beside or below the focused pane. */
export type OpenPlace = "tab" | "right" | "down";

/** Opens a page as a new view, even when one already shows it. A split that doesn't fit the
 * window's grid leaves it as a tab of its own. */
export function openWorkspaceRouteIn(
  route: string,
  place: OpenPlace,
  onOpen: (view: WorkspaceView) => void,
) {
  const surface = workspaceSurfaceFromRoute(route);
  if (!surface) return;
  const workspace = useWorkspaceStore.getState();
  const paneId = workspace.layout.focusedPaneId;
  const view = workspace.addSurface({ ...surface, route });
  if (place !== "tab") useWorkspaceStore.getState().dockView(view.id, paneId, place);
  onOpen({ ...view, route });
}

/**
 * Opens a page dropped on a pane (a chat dragged from the sidebar): beside it in a new split, or
 * in its place for "center", where the pane's page moves to a tab of its own.
 */
export function openWorkspaceRouteAt(
  route: string,
  paneId: string,
  zone: DockDropZone,
  onOpen: (view: WorkspaceView) => void,
) {
  const surface = workspaceSurfaceFromRoute(route);
  if (!surface) return;
  const view = useWorkspaceStore.getState().addSurface({ ...surface, route });
  useWorkspaceStore.getState().dockView(view.id, paneId, zone);
  onOpen({ ...view, route });
}

/** The route of an agent's chat: one conversation, or with `fresh` a new one. */
/**
 * Where an existing chat opens: a chat in a project is Code's, beside the Code page's editor;
 * any other on its agent's chat page.
 */
export function openChatRoute(agentId: string, conversationId: string) {
  if (!isProjectChat(conversationId)) return agentChatRoute(agentId, conversationId);
  openCodeChat(conversationId);
  return "/agents?view=code";
}

export function agentChatRoute(agentId: string, conversationId?: string, fresh = false) {
  const params = new URLSearchParams({ agent: agentId });
  if (conversationId) params.set("conversation", conversationId);
  // A new value each time, so asking twice in a row starts a second new chat.
  if (fresh) params.set("new", String(Date.now()));
  return `/agents?${params}`;
}

/** A new chat with the agent last used here, or one on the person's engines. */
export function newChatRoute() {
  const { agents, selected } = usePersonalAgentsStore.getState();
  const agent =
    agents.find((item) => item.id === selected.global && item.enabled && !item.system_managed) ??
    agents.find((item) => item.engine && item.enabled) ??
    defaultAgentOf(agents) ??
    agents[0];
  return agent ? agentChatRoute(agent.id, undefined, true) : "/agents";
}

/** Starts a new chat in the focused pane. */
export function openNewChat(onOpen: (view: WorkspaceView) => void) {
  openWorkspaceRoute(newChatRoute(), onOpen);
}

/**
 * Opens a new tab on a new chat with the agent last used, not on an idle pane: a new tab is
 * almost always for asking something, so it starts where you can type. Until something is typed
 * or clicked in it, the tab stays `fresh`: a page picked next opens in it, even one another tab
 * already shows, instead of jumping to that tab.
 */
export function openNewTab(onOpen: (view: WorkspaceView) => void) {
  // With no agent to start a chat with, the new tab waits idle on the Agents page.
  const route = newChatRoute();
  const view = useWorkspaceStore.getState().newTab(route === "/agents" ? undefined : route);
  onOpen(view);
}
