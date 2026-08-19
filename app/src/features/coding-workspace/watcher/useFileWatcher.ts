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

interface WatchRegistration {
  refs: number;
  watcherId: string | null;
  unlisten: UnlistenFn | null;
  startupHandle: number;
  disposed: boolean;
}

const watchers = new Map<string, WatchRegistration>();
const refreshTimers = new Map<string, number>();

export function useFileWatcher(rootPath: string | null): void {
  useEffect(() => {
    if (!rootPath) return;
    const existing = watchers.get(rootPath);
    if (existing) existing.refs += 1;
    else {
      const registration: WatchRegistration = {
        refs: 1,
        watcherId: null,
        unlisten: null,
        disposed: false,
        startupHandle: 0,
      };
      registration.startupHandle = window.setTimeout(() => {
        if (registration.disposed) return;
        void (async () => {
          try {
            registration.watcherId = await codeWatchDir(rootPath);
          } catch {
            return;
          }
          if (registration.disposed) {
            if (registration.watcherId) void codeStopWatch(registration.watcherId);
            return;
          }
          registration.unlisten = await listen<FileEvent>(
            "misty://code-file-event",
            ({ payload }) => {
              if (payload.watcherId !== registration.watcherId) return;
              handleEvent(rootPath, payload);
            },
          );
        })();
      }, 1_500);
      watchers.set(rootPath, registration);
    }

    return () => {
      const registration = watchers.get(rootPath);
      if (!registration) return;
      registration.refs -= 1;
      if (registration.refs > 0) return;
      registration.disposed = true;
      window.clearTimeout(registration.startupHandle);
      registration.unlisten?.();
      if (registration.watcherId) void codeStopWatch(registration.watcherId);
      watchers.delete(rootPath);
    };
  }, [rootPath]);
}

function handleEvent(rootPath: string, event: FileEvent) {
  window.dispatchEvent(new CustomEvent("misty:code-index-invalidated", { detail: { rootPath } }));
  const store = useCodingWorkspaceStore.getState();
  const openBuffers = store.projectBuffers[rootPath] ?? {};
  for (const path of event.paths) {
    const buffer = openBuffers[path];
    if (!buffer) continue;
    if (event.kind === "remove") {
      store.patchBuffer(rootPath, path, { error: "File was removed on disk.", loading: false });
      continue;
    }
    const isDirty = buffer.contents !== buffer.savedContents;
    if (isDirty) {
      store.patchBuffer(rootPath, path, {
        error: "This file changed on disk while you had unsaved changes.",
      });
      continue;
    }
    codeReadTextFile(path)
      .then((file) => {
        if (file.contents === buffer.contents) return;
        store.patchBuffer(rootPath, path, {
          contents: file.contents,
          savedContents: file.contents,
          lineEnding: file.lineEnding,
          readonly: file.readonly,
          error: null,
        });
      })
      .catch(() => undefined);
  }

  const refreshTimer = refreshTimers.get(rootPath);
  if (refreshTimer !== undefined) window.clearTimeout(refreshTimer);
  refreshTimers.set(
    rootPath,
    window.setTimeout(() => {
      refreshTimers.delete(rootPath);
      void useGitStore.getState().refresh(rootPath);
    }, 400),
  );
}
