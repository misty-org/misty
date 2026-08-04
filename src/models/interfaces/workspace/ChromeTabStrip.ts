import type { ReactNode } from "react";

export interface ChromeTabStripTab {
  id: string;
  title: string;
  path: string;
  paneId: string;
}

export interface ChromeTabStripProps {
  tabs: ChromeTabStripTab[];
  activeTabId: string;
  actions?: ReactNode;
  addTabControl?: ReactNode;
  ariaLabel?: string;
  canCloseTab?: (tab: ChromeTabStripTab) => boolean;
  onAddTab: () => void;
  onCloseTab: (tab: ChromeTabStripTab) => void;
  onReorderTab?: (tabId: string, fromIndex: number, toIndex: number) => void;
  onSelectTab: (tabId: string) => void;
}
