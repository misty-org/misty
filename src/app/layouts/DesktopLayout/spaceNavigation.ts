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
