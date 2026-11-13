import { type ReactNode } from "react";
import { layoutTabs, tabLabel } from "@/features/app-windows";
import type { WorkspaceLayout, WorkspaceTab } from "@/features/app-windows";
import { useMistyPanelSide } from "@/features/agents";
import { cn, PaneFrame } from "@/shared/ui";
import { WorkspaceMistyDock } from "./WorkspaceMistyDock";
import { treeKeepsLayoutWhileHidden } from "./keptTabs";

/** One panel per workspace tab. The active tab also holds the Misty panel. */
export function WorkspaceTabPanels(props: {
  layout: WorkspaceLayout;
  renderTree(tab: WorkspaceTab, active: boolean): ReactNode;
  /** Where a grid canvas puts the panels, below the Space bar. */
  gridColumn?: number;
}) {
  const { layout } = props;
  const mistySide = useMistyPanelSide();

  return layoutTabs(layout).map((tab) => {
    const active = tab.id === layout.activeTabId;
    // Every panel shares one grid cell, so a kept panel keeps the size it is shown at.
    const kept = !active && treeKeepsLayoutWhileHidden(tab.root);
    return (
      <PaneFrame
        key={tab.id}
        className={
          active || kept
            ? cn(
                "flex min-h-0 min-w-0",
                active ? "z-[1]" : "z-0",
                mistySide === "left" && "flex-row-reverse",
                // Beside the Misty panel the page is a rounded card too: its panes round their
                // corners on that side, so the native page reports them (clippedCornerRadii).
                "has-[>[data-misty-panel-dock=right]]:[&_[data-workspace-pane]]:rounded-r-xl",
                "has-[>[data-misty-panel-dock=left]]:[&_[data-workspace-pane]]:rounded-l-xl",
              )
            : "hidden"
        }
        role="tabpanel"
        style={{ gridColumn: props.gridColumn ?? 1, gridRow: 3 }}
        data-tab-kept={kept ? "" : undefined}
        data-browser-corner-clip="seam"
        aria-label={tabLabel(tab)}
        aria-hidden={!active}
        inert={!active && !kept}
      >
        <div className="misty-pane-frame relative min-h-0 min-w-0 flex-1">
          {props.renderTree(tab, active)}
        </div>
        {active ? <WorkspaceMistyDock /> : null}
      </PaneFrame>
    );
  });
}
