import { useEffect } from "react";
import { useAppStore } from "@/stores/app";
import { useExplorerStore } from "@/stores/explorer";
import type { ExplorerWorkspaceEntry } from "@/models/interfaces/features/explorer/store/types";

export interface ExplorerWorkspaceProps {
  embedded?: boolean;
  workspaceId?: string;
  workspaceTitle?: string;
}

export function useScopedExplorerWorkspace(
  props: ExplorerWorkspaceProps,
  homePath: string,
  settingsLoaded: boolean,
) {
  const appReady = useAppStore((state) => Boolean(state.app?.environment.homeDir));
  const initialize = useExplorerStore((state) => state.initialize);
  const ensureWorkspace = useExplorerStore((state) => state.ensureWorkspace);
  useEffect(() => {
    if (!appReady || !settingsLoaded) return;
    void (async () => {
      await initialize(homePath);
      if (props.workspaceId)
        await ensureWorkspace(props.workspaceId, props.workspaceTitle || "File Manager", homePath);
    })();
  }, [
    appReady,
    ensureWorkspace,
    homePath,
    initialize,
    props.workspaceId,
    props.workspaceTitle,
    settingsLoaded,
  ]);
}

export function scopedWorkspaceEntries(
  entries: ExplorerWorkspaceEntry[],
  workspaceId: string | undefined,
) {
  return workspaceId ? entries.filter((entry) => entry.id === workspaceId) : entries;
}
