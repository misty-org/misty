import { useSettingsStore } from "@/features/settings";
import { dockLeaves, useWorkspaceStore } from "@/features/workspace";
import type { WorkspaceLayout } from "@/features/workspace/model";
import type { MistyPanelSide } from "./MistyPanel";
import { useMistyPanelStore } from "./mistyPanelStore";

/**
 * The browser pane whose content area holds the Misty panel: the one it was opened in
 * while that pane still shows a page, else the focused browser pane, else the last.
 * Null when no pane shows a browser page; the panel then docks beside the panes.
 */
export function mistyPanelHost(layout: WorkspaceLayout, paneId: string | null): string | null {
  const browsers = dockLeaves(layout.root).filter(
    (pane) => pane.views.find((view) => view.id === pane.activeViewId)?.surfaceId === "browser",
  );
  const host =
    browsers.find((pane) => pane.id === paneId) ??
    browsers.find((pane) => pane.id === layout.focusedPaneId) ??
    browsers[browsers.length - 1];
  return host?.id ?? null;
}

export function useMistyPanelHost(): string | null {
  const paneId = useMistyPanelStore((s) => s.paneId);
  return useWorkspaceStore((s) => mistyPanelHost(s.layout, paneId));
}

/** The side chosen in settings (Agents › panel side); right by default. */
export function useMistyPanelSide(): MistyPanelSide {
  const agent = useSettingsStore((s) => s.settings?.document.agent) as
    { panel_side?: string } | undefined;
  return agent?.panel_side === "left" ? "left" : "right";
}
