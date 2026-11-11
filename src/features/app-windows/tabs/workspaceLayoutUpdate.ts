import { reconcileGroupIdentities } from "../panes/groupIdentity";
import type { WorkspaceLayout } from "./workspaceViews";
import type { WorkspaceStore } from "./useWorkspaceStore";
import { withActiveWindowLayout } from "../profiles/windows";

/** The store patch that puts a new layout in the active window, keeping group identities. */
export function withLayout(state: WorkspaceStore, layout: WorkspaceLayout) {
  return withActiveWindowLayout(reconcileGroupIdentities(layout, state.layout));
}
