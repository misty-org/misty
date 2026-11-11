import { workspaceDefaultViewIndex } from "@/features/settings";
import { type WorkspaceView } from "./workspaceViews";

/** Settings store the view's index in the setting's legacy values, where 0 was the retired Home
 * page, 1 the browser and 2 the retired Files tool; all now open Agents. */
const defaultViewSurfaces = [null, "agents", null, "agents"] as const;
const defaultViewChoices = [{ label: "Agents", storedIndex: 3 }] as const;
export const workspaceDefaultViewOptions = defaultViewChoices.map((choice) => choice.label);
export { workspaceDefaultViewIndex };
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
  const surfaceId = defaultViewSurfaces[index] ?? "agents";
  return {
    id,
    surfaceId,
    groupKey: `tool:${surfaceId}`,
    instanceKey: id,
    title: defaultViewChoices.find((choice) => choice.storedIndex === index)?.label ?? "Agents",
    route: `/${surfaceId}`,
    sidebarVisible: true,
    state: {},
    createdAt: now,
    lastFocusedAt: now,
    placeholder,
  };
}
export function createDefaultWorkspaceView(): WorkspaceView {
  return createTab(defaultIndex, true);
}
export const createBlankWorkspaceView = createDefaultWorkspaceView;
