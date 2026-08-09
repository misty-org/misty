import type { MultiPanelClosedPane, MultiPanelTab } from "@/features/workspace";

export interface ProvidersMultiPanelSnapshot {
  tabs: MultiPanelTab[];
  activeTabId: string;
  activePaneId: string;
  closedPanes: MultiPanelClosedPane[];
  nextPaneIndex: number;
  nextTabIndex: number;
}
