import { useEffect, type ReactNode } from "react";
import { layoutTabs, tabLabel } from "@/features/workspace/layoutTabs";
import type { WorkspaceLayout, WorkspaceTab } from "@/features/workspace/model";
import { keepPeek, usePeekStore } from "@/features/workspace/peek";
import { PeekOverlay } from "./PeekOverlay";

/** One panel per workspace tab; a peeked tab floats over the tab it came from. */
export function WorkspaceTabPanels(props: {
  layout: WorkspaceLayout;
  renderTree(tab: WorkspaceTab, active: boolean): ReactNode;
  onClosePeek(): void;
}) {
  const { layout } = props;
  const tabs = layoutTabs(layout);
  const peek = usePeekStore((state) => state.peek);
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
    return (
      <div
        key={tab.id}
        className={active ? "relative min-h-0 min-w-0 flex-1 overflow-hidden" : "hidden"}
        role="tabpanel"
        data-browser-corner-clip="seam"
        aria-label={tabLabel(tab)}
        aria-hidden={!active}
        inert={!active}
      >
        {props.renderTree(tab, tab.id === layout.activeTabId)}
        {peekTab ? (
          <PeekOverlay tab={peekTab} onKeep={keepPeek} onClose={props.onClosePeek}>
            {props.renderTree(peekTab, true)}
          </PeekOverlay>
        ) : null}
      </div>
    );
  });
}
