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

/** Starts a new chat with the agent last used here, or one on the person's engines. */
export function openNewChat(onOpen: (view: WorkspaceView) => void) {
  const { agents, selected } = usePersonalAgentsStore.getState();
  const agent =
    agents.find((item) => item.id === selected.global && item.enabled && !item.system_managed) ??
    agents.find((item) => item.engine && item.enabled) ??
    agents.find((item) => item.system_managed) ??
    agents[0];
  openWorkspaceRoute(agent ? agentChatRoute(agent.id, undefined, true) : "/agents", onOpen);
}
