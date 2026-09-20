import { getCurrentWindow } from "@tauri-apps/api/window";
import { hasTauriInternals } from "@/shared/platform/tauri";
import { useEffect, useMemo } from "react";
import { browserPageTools, useBrowserMediaStore } from "@/features/browser/library";
import { browserRuntimeIdForTabId } from "@/features/webviews/browserRuntime";
import { workspaceTabsById } from "@/features/workspace/layoutTabs";
import type { WorkspaceView } from "@/features/workspace/model";
import { useWorkspaceStore } from "@/features/workspace/useWorkspaceStore";

/**
 * Browser tabs with a player: those playing sound, and those that have played sound and still hold
 * media, paused from the card or from anywhere else. A closed player stays gone until the tab plays
 * sound again.
 */
export function usePlayingViews(): WorkspaceView[] {
  const audible = useBrowserMediaStore((state) => state.audible);
  const paused = useBrowserMediaStore((state) => state.paused);
  const heard = useBrowserMediaStore((state) => state.heard);
  const info = useBrowserMediaStore((state) => state.info);
  const dismissed = useBrowserMediaStore((state) => state.dismissed);
  // The windows object is stable between edits; a fresh map per render is not.
  const windowsByScope = useWorkspaceStore((state) => state.windowsByScope);
  return useMemo(
    () =>
      [...workspaceTabsById({ windowsByScope }).values()].filter(
        (view) =>
          view.surfaceId === "browser" &&
          !dismissed[view.id] &&
          (audible[view.id] || paused[view.id] || (heard[view.id] && info[view.id]?.hasMedia)),
      ),
    [windowsByScope, audible, paused, heard, info, dismissed],
  );
}

/**
 * Each playing page's own media details. Pages push them as they change, so this only reads what
 * they last said. A page that has said nothing yet is asked once, when it first appears; nothing
 * asks again on a timer.
 */
export function useMediaInfo(views: WorkspaceView[], open: boolean) {
  const info = useBrowserMediaStore((state) => state.info);
  const ids = views.map((view) => view.id).join(" ");
  useEffect(() => {
    if (!open) return;
    let current = true;
    ids
      .split(" ")
      .filter(Boolean)
      .forEach((tabId) => {
        if (useBrowserMediaStore.getState().info[tabId]) return;
        const runtimeId = browserRuntimeIdForTabId(tabId);
        if (!runtimeId) return;
        void browserPageTools
          .mediaInfo(runtimeId)
          .then((next) => current && useBrowserMediaStore.getState().setInfo(tabId, next))
          .catch(() => undefined);
      });
    return () => {
      current = false;
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
  useBrowserMediaStore.getState().dismiss(view.id);
  void browserPageTools
    .mediaAction(runtimeId, "pause")
    .catch(() => undefined)
    .finally(() => useBrowserMediaStore.getState().setPaused(view.id, false));
}

/**
 * Picture in picture for the tab's video, where the engine allows it. A video that is already
 * floating goes back into its page, and the page's tab comes forward to receive it.
 */
export function togglePictureInPicture(view: WorkspaceView, floating = false) {
  const runtimeId = browserRuntimeIdForTabId(view.id);
  if (!runtimeId) return;
  void browserPageTools
    .pictureInPicture(runtimeId, floating ? "exit" : "toggle")
    .catch(() => undefined);
  if (floating && hasTauriInternals())
    void getCurrentWindow()
      .unminimize()
      .then(() => getCurrentWindow().setFocus())
      .catch(() => undefined);
  if (floating && useWorkspaceStore.getState().focusView(view.id))
    window.dispatchEvent(
      new CustomEvent("misty:focus-workspace-tab", { detail: { tabId: view.id } }),
    );
}
