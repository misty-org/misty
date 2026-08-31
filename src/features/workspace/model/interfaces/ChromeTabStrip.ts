import type { ReactNode } from "react";

export interface ChromeTabStripTab {
  id: string;
  title: string;
  path: string;
  paneId: string;
  leading?: ReactNode;
  dirty?: boolean;
}

export interface ChromeTabStripProps {
  tabs: ChromeTabStripTab[];
  activeTabId: string;
  actions?: ReactNode;
  addTabControl?: ReactNode;
  ariaLabel?: string;
  className?: string;
  /** Identifies a family of strips that may exchange tabs. */
  dragScope?: string;
  /** Required when an empty strip should accept a moved tab. */
  paneId?: string;
  showAddTabControl?: boolean;
  canCloseTab?: (tab: ChromeTabStripTab) => boolean;
  /** Tabs that own their title. Without this nothing is renameable. */
  canRenameTab?: (tab: ChromeTabStripTab) => boolean;
  onAddTab: () => void;
  onCloseTab: (tab: ChromeTabStripTab) => void;
  onRenameTab?: (tabId: string, title: string) => void;
  onMoveTab?: (
    tabId: string,
    sourcePaneId: string,
    destinationPaneId: string,
    index: number,
  ) => void;
  registerTabDropTarget?: (
    element: HTMLElement,
    tab: ChromeTabStripTab,
    onSpringLoad: () => void,
    springLoad: boolean,
  ) => () => void;
  onReorderTab?: (tabId: string, fromIndex: number, toIndex: number) => void;
  onSelectTab: (tabId: string) => void;
}
