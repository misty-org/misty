import { reconcileGroupIdentities } from "./groupIdentity";
import type { WorkspaceLayout } from "./model";
import type { WorkspaceStore } from "./useWorkspaceStore";
import { withActiveWindowLayout } from "./windows";

/** The store patch that puts a new layout in the active window, keeping group identities. */
export function withLayout(state: WorkspaceStore, layout: WorkspaceLayout) {
  return withActiveWindowLayout(state, reconcileGroupIdentities(layout, state.layout));
}
