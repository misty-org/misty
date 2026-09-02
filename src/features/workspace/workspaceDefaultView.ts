import {
  browserViewTitle,
  createBrowserViewState,
  type WorkspaceScopeKey,
  type WorkspaceView,
} from "./model";

/** Settings store the view's index in the setting's legacy values, where 0 was
 * the retired Home page; it now opens the default. */
const defaultViewSurfaces = [null, "browser", "files", "agents"] as const;
export const workspaceDefaultViewOptions = ["Browser", "Files", "Agents"] as const;
export const workspaceDefaultViewIndex = 1;
let defaultIndex = workspaceDefaultViewIndex;
export function configureWorkspaceDefaultView(index: number): void {
  defaultIndex =
    Number.isInteger(index) && defaultViewSurfaces[index] ? index : workspaceDefaultViewIndex;
}
/** The option shown for a stored index, and the index stored for an option. */
export const workspaceDefaultViewOption = (index: number) =>
  defaultViewSurfaces[index] ? index - 1 : workspaceDefaultViewIndex - 1;
export const workspaceDefaultViewStoredIndex = (option: number) => option + 1;
function createTab(index: number, placeholder: boolean): WorkspaceView {
  const now = Date.now();
  const id = `tab:${crypto.randomUUID()}`;
  const surfaceId = defaultViewSurfaces[index] ?? "browser";
  const state = surfaceId === "browser" ? createBrowserViewState() : {};
  return {
    id,
    surfaceId,
    groupKey: `tool:${surfaceId}`,
    instanceKey: id,
    title:
      surfaceId === "browser"
        ? browserViewTitle((state as { url: string }).url)
        : workspaceDefaultViewOptions[index - 1],
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
