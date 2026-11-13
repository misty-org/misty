import { usePersonalAgentsStore } from "@/features/agents";
import {
  useWorkspaceStore,
  workspaceSurfaceFromRoute,
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

/** The route of an agent's chat: one conversation, or with `fresh` a new one. */
export function agentChatRoute(agentId: string, conversationId?: string, fresh = false) {
  const params = new URLSearchParams({ agent: agentId });
  if (conversationId) params.set("conversation", conversationId);
  // A new value each time, so asking twice in a row starts a second new chat.
  if (fresh) params.set("new", String(Date.now()));
  return `/agents?${params}`;
}

/** A new chat with the agent last used here, or one on the person's engines. */
function newChatRoute() {
  const { agents, selected } = usePersonalAgentsStore.getState();
  const agent =
    agents.find((item) => item.id === selected.global && item.enabled && !item.system_managed) ??
    agents.find((item) => item.engine && item.enabled) ??
    agents.find((item) => item.system_managed) ??
    agents[0];
  return agent ? agentChatRoute(agent.id, undefined, true) : "/agents";
}

/** Starts a new chat in the focused pane. */
export function openNewChat(onOpen: (view: WorkspaceView) => void) {
  openWorkspaceRoute(newChatRoute(), onOpen);
}

/**
 * Opens a new tab on a new chat with the agent last used, not on an idle pane: a new tab is
 * almost always for asking something, so it starts where you can type.
 */
export function openNewTab(onOpen: (view: WorkspaceView) => void) {
  const workspace = useWorkspaceStore.getState();
  const view = workspace.newTab();
  const route = newChatRoute();
  workspace.updateViewRoute(view.id, route, true);
  onOpen({ ...view, route });
}
