import { defaultAgentOf, usePersonalAgentsStore } from "@/features/agents";
import {
  useWorkspaceStore,
  workspaceSurfaceFromRoute,
  type DockDropZone,
  type WorkspaceView,
} from "@/features/app-windows";

export function openWorkspaceRoute(route: string, onOpen: (view: WorkspaceView) => void) {
  const surface = workspaceSurfaceFromRoute(route);
  if (!surface) return;
  const workspace = useWorkspaceStore.getState();
  const view = workspace.openDestination(surface);
  if (view.route !== route) workspace.updateViewRoute(view.id, route, true);
  onOpen({ ...view, route });
}

export type OpenPlace = "tab" | "right" | "down";

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

export function openChatRoute(agentId: string, conversationId: string) {
  return agentChatRoute(agentId, conversationId);
}

export function agentChatRoute(agentId: string, conversationId?: string, fresh = false) {
  const params = new URLSearchParams({ agent: agentId });
  if (conversationId) params.set("conversation", conversationId);
  if (fresh) params.set("new", String(Date.now()));
  return `/agents?${params}`;
}

export function agentSharedThreadRoute(agentId: string, threadId: string) {
  return `/agents?${new URLSearchParams({ agent: agentId, thread: threadId })}`;
}

export function newChatRoute() {
  const { agents, selected } = usePersonalAgentsStore.getState();
  const agent =
    agents.find((item) => item.id === selected.global && item.enabled && !item.system_managed) ??
    agents.find((item) => item.engine && item.enabled) ??
    defaultAgentOf(agents) ??
    agents[0];
  return agent ? agentChatRoute(agent.id, undefined, true) : "/agents";
}

export function openNewChat(onOpen: (view: WorkspaceView) => void) {
  openWorkspaceRoute(newChatRoute(), onOpen);
}

export function openNewTab(onOpen: (view: WorkspaceView) => void) {
  const route = newChatRoute();
  const view = useWorkspaceStore.getState().newTab(route === "/agents" ? undefined : route);
  onOpen(view);
}
