import { layoutTabs } from "@/features/workspace/layoutTabs";
import { dockLeaves } from "@/features/workspace/dockTree";
import { isPrivateBrowserTab } from "@/features/workspace/privateBrowsing";
import { parseBrowserTabState, type WorkspaceTab } from "@/features/workspace/model";
import { useWorkspaceStore } from "@/features/workspace/useWorkspaceStore";
import {
  browserRuntimeCreated,
  browserRuntimeId,
  useBrowserRuntimeStore,
} from "@/features/webviews/browserRuntime";

/** Synced browser tabs with a live page; private tabs never participate. */
export function liveBrowserTabs(): WorkspaceTab[] {
  const windows = useWorkspaceStore.getState().virtualWindowsByScope.global ?? [];
  return windows
    .flatMap((window) =>
      layoutTabs(window.layout).flatMap((layout) =>
        dockLeaves(layout.root).flatMap((pane) =>
          pane.tabs.filter((tab) => tab.surfaceId === "browser" && !isPrivateBrowserTab(tab)),
        ),
      ),
    )
    .filter((tab) => /^https?:/.test(parseBrowserTabState(tab.state).url))
    .sort((a, b) => b.lastFocusedAt - a.lastFocusedAt);
}

export const tabUrl = (tab: WorkspaceTab) => parseBrowserTabState(tab.state).url;
export const runtimeOf = (tab: WorkspaceTab) => browserRuntimeId(tab);
export const pageReady = (tab: WorkspaceTab) =>
  browserRuntimeCreated(tab) && !useBrowserRuntimeStore.getState().loading[tab.id];
