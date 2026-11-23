import { reconcileGroupIdentities } from "../panes/group_identity";
import type { WorkspaceLayout } from "./workspace_views";
import type { WorkspaceStore } from "./use_workspace_store";
import { withActiveWindowLayout } from "../profiles/windows";

export function withLayout(state: WorkspaceStore, layout: WorkspaceLayout) {
  return withActiveWindowLayout(reconcileGroupIdentities(layout, state.layout));
}
