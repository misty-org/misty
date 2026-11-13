import { type WorkspaceView } from "./workspaceViews";

/** A new tab or split: it always opens Agents. */
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
export const createBlankWorkspaceView = createDefaultWorkspaceView;

/**
 * The retired "New tabs and splits" setting's hook. Every tab opens Agents now, so it changes
 * nothing; it stays only until the last test that calls it drops the call.
 */
export function configureWorkspaceDefaultView(_index: number): void {}
