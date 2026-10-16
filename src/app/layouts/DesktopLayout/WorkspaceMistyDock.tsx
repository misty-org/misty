import { MistyPanelDock, useMistyPanelSide, useMistyPanelStore } from "@/features/agents";
import { dockLeaves, useWorkspaceStore } from "@/features/workspace";

/**
 * The Misty panel beside the panes: a rounded panel of its own, set off from the page by a margin
 * of window chrome, as the tab drawer is on the other side. It shows only while the focused pane
 * holds a browser page: on the Agents page the agent is already the page.
 */
export function WorkspaceMistyDock() {
  const requested = useMistyPanelStore((s) => s.open);
  const onBrowserPage = useWorkspaceStore((s) => {
    const pane = dockLeaves(s.layout.root).find((leaf) => leaf.id === s.layout.focusedPaneId);
    return pane?.views.find((view) => view.id === pane.activeViewId)?.surfaceId === "browser";
  });
  const open = requested && onBrowserPage;
  const side = useMistyPanelSide();
  return <MistyPanelDock open={open} side={side} />;
}
