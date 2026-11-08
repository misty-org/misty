import { layoutTabs } from "@/features/app-windows";
import { dockLeaves } from "@/features/app-windows";
import { parseBrowserViewState, type WorkspaceView } from "@/features/app-windows";
import { useWorkspaceStore } from "@/features/app-windows";
import {
  browserRuntimeCreated,
  browserRuntimeId,
  useBrowserRuntimeStore,
} from "../webviews/browserRuntime";
import { isIncognitoWindow } from "@/features/app-windows";

/** Browser tabs with a web page in this window; incognito windows keep no page state. */
export function liveBrowserViews(): WorkspaceView[] {
  if (isIncognitoWindow()) return [];
  return layoutTabs(useWorkspaceStore.getState().layout)
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
