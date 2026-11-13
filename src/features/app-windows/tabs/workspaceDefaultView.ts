import { type WorkspaceView } from "./workspaceViews";

/** A new tab or split: an idle placeholder on the Agents route, shown as an empty pane until
 * something is opened in it. */
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
