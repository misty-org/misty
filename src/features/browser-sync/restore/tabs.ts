import { layoutTabs } from "@/features/workspace/layoutTabs";
import { dockLeaves } from "@/features/workspace/dockTree";
import { parseBrowserViewState, type WorkspaceView } from "@/features/workspace/model";
import { useWorkspaceStore } from "@/features/workspace/useWorkspaceStore";
import {
  browserRuntimeCreated,
  browserRuntimeId,
  useBrowserRuntimeStore,
} from "@/features/webviews/browserRuntime";
import { isIncognitoWindow } from "@/features/workspace/spaceWindow";
import { spaceLayout } from "@/features/workspace/windows";

/** Synced browser tabs with a live page in this window; incognito windows never sync. */
export function liveBrowserViews(): WorkspaceView[] {
  if (isIncognitoWindow()) return [];
  const layout = spaceLayout(useWorkspaceStore.getState());
  return layoutTabs(layout)
    .flatMap((tab) =>
      dockLeaves(tab.root).flatMap((pane) =>
        pane.views.filter((view) => view.surfaceId === "browser"),
      ),
    )
    .filter((tab) => /^https?:/.test(parseBrowserViewState(tab.state).url))
    .sort((a, b) => b.lastFocusedAt - a.lastFocusedAt);
}

export const viewUrl = (tab: WorkspaceView) => parseBrowserViewState(tab.state).url;
export const runtimeOf = (tab: WorkspaceView) => browserRuntimeId(tab);
export const pageReady = (tab: WorkspaceView) =>
  browserRuntimeCreated(tab) && !useBrowserRuntimeStore.getState().loading[tab.id];
