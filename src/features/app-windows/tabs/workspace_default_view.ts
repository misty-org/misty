import { type WorkspaceView } from "./workspace_views";

function createTab(placeholder: boolean): WorkspaceView {
  const now = Date.now();
  const id = `tab:${crypto.randomUUID()}`;
  return {
    id,
    surfaceId: "agents",
    groupKey: "tool:agents",
    instanceKey: id,
    title: "Agents",
    route: "/agents",
    sidebarVisible: true,
    state: {},
    createdAt: now,
    lastFocusedAt: now,
    placeholder,
  };
}
export function createDefaultWorkspaceView(): WorkspaceView {
  return createTab(true);
}
