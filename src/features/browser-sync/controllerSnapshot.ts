import type { WorkspaceWindow } from "@/features/workspace/model";
import type { MistyTabGroup } from "@/features/workspace/tabGroups";
import { deviceSelection } from "./changes";
import type { NativeSyncView } from "./native";
import type { DeviceSelection, SharedRecord, WorkspaceRecords } from "./model";
import type { ProjectedWorkspace } from "./projection";
import { tabGroupRecords } from "./tabGroupSync";

// What the sync controller (controller.ts) reads from the visible workspace and the native view.

export interface WorkspaceSource {
  read(): {
    windows: WorkspaceWindow[];
    activeWindowId: string;
    folders?: SharedRecord<"folder">[];
    bookmarks?: SharedRecord<"bookmark">[];
    tabGroups?: MistyTabGroup[];
  };
  write(projected: ProjectedWorkspace): void;
  subscribe(changed: () => void): () => void;
}
/** Another machine's focus is not content: it never triggers a projection. */
export function projectionContent(view: WorkspaceRecords) {
  return { records: view.records, activeDevice: view.active_device };
}

export function localSelection(source: ReturnType<WorkspaceSource["read"]>): DeviceSelection {
  return deviceSelection(source.windows, source.activeWindowId);
}

/** Records captured by diff rather than from the window structure: bookmark
 * folders and links, and tab groups once every device syncs them. */
export function navigationRecords(
  source: ReturnType<WorkspaceSource["read"]>,
  withGroups: boolean,
): SharedRecord[] {
  return [
    ...(source.folders ?? []),
    ...(source.bookmarks ?? []),
    ...(withGroups ? tabGroupRecords(source.windows, source.tabGroups ?? []) : []),
  ];
}

/** Tab groups sync only once every device understands them. */
export function groupsSynced(view: NativeSyncView): boolean {
  return view.sync?.all_upgraded === true;
}

/** This machine's groups, for their local collapsed state, when groups sync. */
export function localGroups(view: NativeSyncView, source: ReturnType<WorkspaceSource["read"]>) {
  return groupsSynced(view) ? (source.tabGroups ?? []) : undefined;
}
