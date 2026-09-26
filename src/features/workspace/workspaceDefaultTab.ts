import { createBrowserTabState, type WorkspaceScopeKey, type WorkspaceTab } from "./model";

export const workspaceDefaultTabOptions = ["Google"] as const;
export function configureWorkspaceDefaultTab(_index: number): void {}
export function workspaceDefaultTabIndex(): number { return 0; }
export function createDefaultWorkspaceTab(_scopeKey: WorkspaceScopeKey): WorkspaceTab {
  const now = Date.now();
  const id = `tab:${crypto.randomUUID()}`;
  return {
    id, surfaceId: "browser", groupKey: "tool:browser", instanceKey: id,
    title: "Google", route: "/browser", sidebarVisible: false,
    state: createBrowserTabState(), createdAt: now, lastFocusedAt: now,
  };
}
export const createHomeWorkspaceTab = createDefaultWorkspaceTab;
export const createBlankWorkspaceTab = createDefaultWorkspaceTab;
