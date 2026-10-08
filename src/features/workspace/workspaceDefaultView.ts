import {
  browserViewTitle,
  createBrowserViewState,
  type WorkspaceScopeKey,
  type WorkspaceView,
} from "./model";

/** Settings store the view's index in the setting's legacy values, where 0 was
 * the retired Home page and 2 the retired Files tool; both now open the default. */
const defaultViewSurfaces = [null, "browser", null, "agents"] as const;
const defaultViewChoices = [
  { label: "Browser", storedIndex: 1 },
  { label: "Agents", storedIndex: 3 },
] as const;
export const workspaceDefaultViewOptions = defaultViewChoices.map((choice) => choice.label);
export const workspaceDefaultViewIndex = 1;
let defaultIndex = workspaceDefaultViewIndex;
export function configureWorkspaceDefaultView(index: number): void {
  defaultIndex =
    Number.isInteger(index) && defaultViewSurfaces[index] ? index : workspaceDefaultViewIndex;
}
/** The option shown for a stored index, and the index stored for an option. */
export const workspaceDefaultViewOption = (index: number) =>
  Math.max(
    0,
    defaultViewChoices.findIndex(
      (choice) =>
        choice.storedIndex === (defaultViewSurfaces[index] ? index : workspaceDefaultViewIndex),
    ),
  );
export const workspaceDefaultViewStoredIndex = (option: number) =>
  defaultViewChoices[option]?.storedIndex ?? workspaceDefaultViewIndex;
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
        : (defaultViewChoices.find((choice) => choice.storedIndex === index)?.label ?? "Agents"),
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
