// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
import { useCallback, useEffect, useMemo, useState } from "react";
import { createDeviceSetting } from "@/shared/lib/deviceSetting";
import { watchAllRunEvents } from "../../runs/local-run/localRunEvents";
import type { GitStatus } from "./gitApi";
import { useGitStore } from "./store";

/** The list or tree choice, kept for this device in `misty.db`. */
const useViewModeSetting = createDeviceSetting<"flat" | "tree">({
  scope: "changes-view-mode",
  defaults: "tree",
  normalize: (stored) => (stored === "flat" ? "flat" : "tree"),
  legacyKey: "misty.changes.viewMode",
});

export function useGitViewMode() {
  const viewMode = useViewModeSetting((state) => state.value);
  const toggleViewMode = useCallback(() => {
    useViewModeSetting.getState().set((current) => (current === "tree" ? "flat" : "tree"));
  }, []);
  return { viewMode, toggleViewMode };
}

/** Which files the commit takes. Staged files start ticked; a refresh drops files that are gone
 * and ticks files staged elsewhere (a terminal, an agent). The adjustment happens while rendering,
 * so a stale selection never reaches the screen. */
export function useChangesSelection(status: GitStatus | undefined) {
  const stagedPaths = useMemo(() => status?.staged.map((file) => file.path) ?? [], [status]);
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(() => new Set(stagedPaths));
  const [previousStaged, setPreviousStaged] = useState<string[]>(stagedPaths);

  if (previousStaged !== stagedPaths) {
    setPreviousStaged(stagedPaths);
    setSelectedFiles((previous) => {
      const current = new Set([
        ...stagedPaths,
        ...(status?.unstaged ?? []).map((file) => file.path),
        ...(status?.untracked ?? []).map((file) => file.path),
      ]);
      const next = new Set<string>();
      for (const path of previous) if (current.has(path)) next.add(path);
      const before = new Set(previousStaged);
      for (const path of stagedPaths) if (!before.has(path)) next.add(path);
      return next;
    });
  }

  const toggleSelectFile = useCallback((path: string) => {
    setSelectedFiles((previous) => {
      const next = new Set(previous);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  const toggleSelectMany = useCallback((paths: string[]) => {
    setSelectedFiles((previous) => {
      const next = new Set(previous);
      const all = paths.length > 0 && paths.every((path) => next.has(path));
      for (const path of paths) {
        if (all) next.delete(path);
        else next.add(path);
      }
      return next;
    });
  }, []);

  return { selectedFiles, setSelectedFiles, toggleSelectFile, toggleSelectMany };
}

/** Reads the status as agents work (they are what changes the files) and when the window is back. */
export function useRefreshWhileWorking(repository: string) {
  useEffect(() => {
    const git = useGitStore.getState();
    void git.refresh(repository);
    void git.loadBranches(repository);
    let timer: number | undefined;
    const later = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => void useGitStore.getState().refresh(repository, true), 700);
    };
    const stop = watchAllRunEvents((_run, event) => {
      if (event.type.startsWith("tool.") || event.type.startsWith("invocation.")) later();
    });
    const onFocus = () => void useGitStore.getState().refresh(repository);
    window.addEventListener("focus", onFocus);
    return () => {
      window.clearTimeout(timer);
      stop();
      window.removeEventListener("focus", onFocus);
    };
  }, [repository]);
}
