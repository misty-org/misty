import { type ReactNode } from "react";
import { layoutTabs, tabLabel } from "@/features/app-windows";
import type { WorkspaceLayout, WorkspaceTab } from "@/features/app-windows";
import { useMistyPanelSide } from "@/features/agents";
import { cn, PaneFrame } from "@misty/ui";
import { WorkspaceMistyDock } from "./WorkspaceMistyDock";
import { treeKeepsLayoutWhileHidden } from "./kept_tabs";

export function WorkspaceTabPanels(props: {
  layout: WorkspaceLayout;
  away?: WorkspaceLayout[];
  renderTree(tab: WorkspaceTab, active: boolean): ReactNode;
  gridColumn?: number;
}) {
  const { layout } = props;
  const mistySide = useMistyPanelSide();

  const shown = layoutTabs(layout).map((tab) => ({ tab, elsewhere: false }));
  const running = (props.away ?? []).flatMap((aside) =>
    layoutTabs(aside).map((tab) => ({ tab, elsewhere: true })),
  );

  return [...shown, ...running].map(({ tab, elsewhere }) => {
    const active = !elsewhere && tab.id === layout.activeTabId;
    const kept = !active && !elsewhere && treeKeepsLayoutWhileHidden(tab.root);
    return (
      <PaneFrame
        key={tab.id}
        className={
          active || kept
            ? cn(
                "flex min-h-0 min-w-0",
                active ? "z-[1]" : "invisible z-0",
                mistySide === "left" && "flex-row-reverse",
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
        <div className="relative min-h-0 min-w-0 flex-1">{props.renderTree(tab, active)}</div>
        {active ? <WorkspaceMistyDock /> : null}
      </PaneFrame>
    );
  });
}
