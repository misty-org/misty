import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { useEffect } from "react";
import { codeReadTextFile, codeStopWatch, codeWatchDir } from "../native";
import { useCodingWorkspaceStore } from "../store/useCodingWorkspaceStore";
import { useGitStore } from "../git/useGitStore";

interface FileEvent {
  watcherId: string;
  root: string;
  paths: string[];
  kind: "create" | "modify" | "remove";
}

let refreshTimer: number | null = null;

export function useFileWatcher(rootPath: string | null): void {
  useEffect(() => {
    if (!rootPath) return;
    let cancelled = false;
    let watcherId: string | null = null;
    let unlisten: UnlistenFn | null = null;

    // Defer the watcher spawn until the browser is idle so entering the Code
    // tab paints before Rust registers the notify watcher.
    const startupHandle = window.setTimeout(() => {
      if (cancelled) return;
      void (async () => {
        try {
          watcherId = await codeWatchDir(rootPath);
        } catch {
          return;
        }
        if (cancelled) {
          if (watcherId) void codeStopWatch(watcherId);
          return;
        }
        unlisten = await listen<FileEvent>("misty://code-file-event", ({ payload }) => {
          if (payload.watcherId !== watcherId) return;
          handleEvent(rootPath, payload);
        });
      })();
    }, 1_500);

    return () => {
      cancelled = true;
      window.clearTimeout(startupHandle);
      unlisten?.();
      if (watcherId) void codeStopWatch(watcherId);
    };
  }, [rootPath]);
}

function handleEvent(rootPath: string, event: FileEvent) {
  const store = useCodingWorkspaceStore.getState();
  const openTabs = store.groups.flatMap((group) => group.tabs);
  for (const path of event.paths) {
    const tab = openTabs.find((entry) => entry.path === path);
    if (!tab) continue;
    if (event.kind === "remove") {
      store.patchTab(path, { error: "File was removed on disk.", loading: false });
      continue;
    }
    const isDirty = tab.contents !== tab.savedContents;
    if (isDirty) {
      store.patchTab(path, {
        error: "This file changed on disk while you had unsaved changes.",
      });
      continue;
    }
    codeReadTextFile(path)
      .then((file) => {
        if (file.contents === tab.contents) return;
        store.patchTab(path, {
          contents: file.contents,
          savedContents: file.contents,
          lineEnding: file.lineEnding,
          readonly: file.readonly,
          error: null,
        });
      })
      .catch(() => undefined);
  }

  if (refreshTimer !== null) window.clearTimeout(refreshTimer);
  refreshTimer = window.setTimeout(() => {
    refreshTimer = null;
    void useGitStore.getState().refresh(rootPath);
  }, 400);
}
