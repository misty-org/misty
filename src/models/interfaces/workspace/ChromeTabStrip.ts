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
  /** Tabs that own their title. Without this nothing is renameable. */
  canRenameTab?: (tab: ChromeTabStripTab) => boolean;
  onAddTab: () => void;
  onCloseTab: (tab: ChromeTabStripTab) => void;
  onRenameTab?: (tabId: string, title: string) => void;
  onReorderTab?: (tabId: string, fromIndex: number, toIndex: number) => void;
  onSelectTab: (tabId: string) => void;
}
