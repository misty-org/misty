import { layoutTabs } from "@/features/workspace/layoutTabs";
import { dockLeaves } from "@/features/workspace/dockTree";
import { isPrivateBrowserView } from "@/features/workspace/privateBrowsing";
import { parseBrowserViewState, type WorkspaceView } from "@/features/workspace/model";
import { useWorkspaceStore } from "@/features/workspace/useWorkspaceStore";
import {
  browserRuntimeCreated,
  browserRuntimeId,
  useBrowserRuntimeStore,
} from "@/features/webviews/browserRuntime";

/** Synced browser tabs with a live page; private tabs never participate. */
export function liveBrowserViews(): WorkspaceView[] {
  const windows = useWorkspaceStore.getState().windowsByScope.global ?? [];
  return windows
    .flatMap((window) =>
      layoutTabs(window.layout).flatMap((layout) =>
        dockLeaves(layout.root).flatMap((pane) =>
          pane.views.filter((tab) => tab.surfaceId === "browser" && !isPrivateBrowserView(tab)),
        ),
      ),
    )
    .filter((tab) => /^https?:/.test(parseBrowserViewState(tab.state).url))
    .sort((a, b) => b.lastFocusedAt - a.lastFocusedAt);
}

export const viewUrl = (tab: WorkspaceView) => parseBrowserViewState(tab.state).url;
export const runtimeOf = (tab: WorkspaceView) => browserRuntimeId(tab);
export const pageReady = (tab: WorkspaceView) =>
  browserRuntimeCreated(tab) && !useBrowserRuntimeStore.getState().loading[tab.id];
