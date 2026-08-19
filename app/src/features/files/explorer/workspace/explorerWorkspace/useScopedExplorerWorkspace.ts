import { useAppStore } from "@/features/app-shell";
import { useEffect } from "react";
import { useExplorerStore } from "../../store";

export interface ExplorerWorkspaceProps {
  embedded?: boolean;
  workspaceId?: string;
  workspaceTitle?: string;
}

export function useScopedExplorerWorkspace(
  _props: ExplorerWorkspaceProps,
  homePath: string,
  _settingsLoaded: boolean,
) {
  const initialize = useExplorerStore((state) => state.initialize);
  useEffect(() => {
    if (!homePath) return;
    void initialize(homePath);
  }, [homePath, initialize]);
}
