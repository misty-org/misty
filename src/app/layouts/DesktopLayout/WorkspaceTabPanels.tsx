import { useEffect, type ReactNode } from "react";
import { layoutTabs, tabLabel } from "@/features/workspace/layoutTabs";
import type { WorkspaceLayout, WorkspaceTab } from "@/features/workspace/model";
import { keepPeek, usePeekStore } from "@/features/workspace/peek";
import { useMistyPanelSide } from "@/features/agents";
import { cn } from "@/shared/ui";
import { PeekOverlay } from "./PeekOverlay";
import { WorkspaceMistyDock } from "./WorkspaceMistyDock";
import { treeKeepsLayoutWhileHidden } from "./keptTabs";

/** One panel per workspace tab; a peeked tab floats over the tab it came from. The
 * active tab also holds the Misty panel when no browser pane does. */
export function WorkspaceTabPanels(props: {
  layout: WorkspaceLayout;
  renderTree(tab: WorkspaceTab, active: boolean): ReactNode;
  onClosePeek(): void;
  /** Where a grid canvas puts the panels, below the Space bar. */
  gridColumn?: number;
}) {
  const { layout } = props;
  const tabs = layoutTabs(layout);
  const peek = usePeekStore((state) => state.peek);
  const mistySide = useMistyPanelSide();
  const peeking =
    peek && peek.tabId === layout.activeTabId && tabs.some((tab) => tab.id === peek.sourceTabId)
      ? peek
      : null;
  // Choosing any other tab keeps the peeked page as an ordinary tab.
  useEffect(() => {
    if (peek && peek.tabId !== layout.activeTabId) keepPeek();
  }, [peek, layout.activeTabId]);

  return tabs.map((tab) => {
    // A peeked tab floats over its source instead of replacing it.
    if (peeking?.tabId === tab.id) return null;
    const source = peeking?.sourceTabId === tab.id;
    const peekTab = source ? tabs.find((item) => item.id === peeking.tabId) : null;
    const active = tab.id === layout.activeTabId || source;
    // Every panel shares one grid cell, so a kept panel keeps the size it is shown at.
    const kept = !active && treeKeepsLayoutWhileHidden(tab.root);
    return (
      <div
        key={tab.id}
        className={
          active || kept
            ? cn(
                "relative flex min-h-0 min-w-0 overflow-hidden",
                active ? "z-[1]" : "z-0",
                mistySide === "left" && "flex-row-reverse",
              )
            : "hidden"
        }
        role="tabpanel"
        style={{ gridColumn: props.gridColumn ?? 1, gridRow: 2 }}
        data-tab-kept={kept ? "" : undefined}
        data-browser-corner-clip="seam"
        aria-label={tabLabel(tab)}
        aria-hidden={!active}
        inert={!active && !kept}
      >
        <div className="misty-pane-frame relative min-h-0 min-w-0 flex-1">
          {props.renderTree(tab, tab.id === layout.activeTabId)}
        </div>
        {tab.id === layout.activeTabId ? <WorkspaceMistyDock /> : null}
        {peekTab ? (
          <PeekOverlay tab={peekTab} onKeep={keepPeek} onClose={props.onClosePeek}>
            {props.renderTree(peekTab, true)}
          </PeekOverlay>
        ) : null}
      </div>
    );
  });
}
