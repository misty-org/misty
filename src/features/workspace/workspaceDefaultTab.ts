import {
  browserTabTitle,
  createBrowserTabState,
  type WorkspaceScopeKey,
  type WorkspaceTab,
} from "./model";

export const workspaceDefaultTabOptions = ["Home", "Browser", "Files", "Agents"] as const;
let defaultIndex = 0;
export function configureWorkspaceDefaultTab(index: number): void {
  defaultIndex =
    Number.isInteger(index) && index >= 0 && index < workspaceDefaultTabOptions.length ? index : 0;
}
export function workspaceDefaultTabIndex(): number {
  return defaultIndex;
}
function createTab(index: number, placeholder: boolean): WorkspaceTab {
  const now = Date.now();
  const id = `tab:${crypto.randomUUID()}`;
  const surfaceId = (["home", "browser", "files", "agents"] as const)[index];
  const state = surfaceId === "browser" ? createBrowserTabState() : {};
  return {
    id,
    surfaceId,
    groupKey: `tool:${surfaceId}`,
    instanceKey: id,
    title:
      surfaceId === "browser"
        ? browserTabTitle((state as { url: string }).url)
        : workspaceDefaultTabOptions[index],
    route: `/${surfaceId}`,
    sidebarVisible: surfaceId !== "browser",
    state,
    createdAt: now,
    lastFocusedAt: now,
    placeholder,
  };
}
export function createHomeWorkspaceTab(_scopeKey: WorkspaceScopeKey): WorkspaceTab {
  return createTab(0, false);
}
export function createDefaultWorkspaceTab(_scopeKey: WorkspaceScopeKey): WorkspaceTab {
  return createTab(defaultIndex, true);
}
export const createBlankWorkspaceTab = createDefaultWorkspaceTab;
