import type { ReactNode } from "react";

export function useExplorerAgentDock({
  activePaneId: _activePaneId,
  activePath: _activePath,
  fallbackInspector,
}: {
  activePaneId: string;
  activePath: string;
  fallbackInspector?: ReactNode;
}) {
  return { enabled: false, open: false, toggle: () => undefined, inspector: fallbackInspector };
}
