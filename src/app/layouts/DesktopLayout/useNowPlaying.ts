import { useEffect, useMemo, useState } from "react";
import {
  browserPageTools,
  useBrowserMediaStore,
  type BrowserMediaInfo,
} from "@/features/browser/library";
import { browserRuntimeIdForTabId } from "@/features/webviews/browserRuntime";
import { workspaceTabsById } from "@/features/workspace/layoutTabs";
import type { WorkspaceView } from "@/features/workspace/model";
import { useWorkspaceStore } from "@/features/workspace/useWorkspaceStore";

const refreshMs = 750;

/** Browser tabs playing sound, or paused from the player, across every window. */
export function usePlayingViews(): WorkspaceView[] {
  const audible = useBrowserMediaStore((state) => state.audible);
  const paused = useBrowserMediaStore((state) => state.paused);
  // The windows object is stable between edits; a fresh map per render is not.
  const windowsByScope = useWorkspaceStore((state) => state.windowsByScope);
  return useMemo(
    () =>
      [...workspaceTabsById({ windowsByScope }).values()].filter(
        (view) => view.surfaceId === "browser" && (audible[view.id] || paused[view.id]),
      ),
    [windowsByScope, audible, paused],
  );
}

/** Each playing page's own media details, refreshed while the player is open. */
export function useMediaInfo(views: WorkspaceView[], open: boolean) {
  const [info, setInfo] = useState<Record<string, BrowserMediaInfo>>({});
  const ids = views.map((view) => view.id).join(" ");
  useEffect(() => {
    if (!open) return;
    let current = true;
    const refresh = () =>
      ids
        .split(" ")
        .filter(Boolean)
        .forEach((tabId) => {
          const runtimeId = browserRuntimeIdForTabId(tabId);
          if (!runtimeId) return;
          void browserPageTools
            .mediaInfo(runtimeId)
            .then((next) => current && setInfo((previous) => ({ ...previous, [tabId]: next })))
            .catch(() => undefined);
        });
    refresh();
    const interval = setInterval(refresh, refreshMs);
    return () => {
      current = false;
      clearInterval(interval);
    };
  }, [ids, open]);
  return info;
}

export function actOnMedia(
  view: WorkspaceView,
  action: "play" | "pause" | "previoustrack" | "nexttrack" | "seekto",
  position?: number,
) {
  const runtimeId = browserRuntimeIdForTabId(view.id);
  if (!runtimeId) return;
  void browserPageTools
    .mediaAction(runtimeId, action, position)
    .then(() => {
      // Paused from here, the tab stays listed so it can be resumed.
      if (action === "pause") useBrowserMediaStore.getState().setPaused(view.id, true);
      if (action === "play") useBrowserMediaStore.getState().setPaused(view.id, false);
    })
    .catch(() => undefined);
}

/** Closes the player for a tab the way Zen's X does: the page is paused and its card leaves,
 * until it plays again. */
export function closeMedia(view: WorkspaceView) {
  const runtimeId = browserRuntimeIdForTabId(view.id);
  if (!runtimeId) return;
  void browserPageTools
    .mediaAction(runtimeId, "pause")
    .catch(() => undefined)
    .finally(() => useBrowserMediaStore.getState().setPaused(view.id, false));
}

/** Picture in picture for the tab's video, where the engine allows it. */
export function togglePictureInPicture(view: WorkspaceView) {
  const runtimeId = browserRuntimeIdForTabId(view.id);
  if (!runtimeId) return;
  void browserPageTools.pictureInPicture(runtimeId, "toggle").catch(() => undefined);
}
