import {
  browserViewTitle,
  createBrowserViewState,
  type WorkspaceScopeKey,
  type WorkspaceView,
} from "./model";

export const workspaceDefaultViewOptions = ["Home", "Browser", "Files", "Agents"] as const;
let defaultIndex = 0;
export function configureWorkspaceDefaultView(index: number): void {
  defaultIndex =
    Number.isInteger(index) && index >= 0 && index < workspaceDefaultViewOptions.length ? index : 0;
}
function createTab(index: number, placeholder: boolean): WorkspaceView {
  const now = Date.now();
  const id = `tab:${crypto.randomUUID()}`;
  const surfaceId = (["home", "browser", "files", "agents"] as const)[index];
  const state = surfaceId === "browser" ? createBrowserViewState() : {};
  return {
    id,
    surfaceId,
    groupKey: `tool:${surfaceId}`,
    instanceKey: id,
    title:
      surfaceId === "browser"
        ? browserViewTitle((state as { url: string }).url)
        : workspaceDefaultViewOptions[index],
    route: `/${surfaceId}`,
    sidebarVisible: surfaceId !== "browser",
    state,
    createdAt: now,
    lastFocusedAt: now,
    placeholder,
  };
}
export function createDefaultWorkspaceView(_scopeKey: WorkspaceScopeKey): WorkspaceView {
  return createTab(defaultIndex, true);
}
export const createBlankWorkspaceView = createDefaultWorkspaceView;
