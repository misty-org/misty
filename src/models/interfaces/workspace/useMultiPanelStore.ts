import { create } from "zustand";
import type { SplitOrientation } from "@/features/workspace/useMultiPanelStore";
import type {
  MultiPanelClosedPane,
  MultiPanelLayout,
  MultiPanelPane,
  MultiPanelTab,
} from "@/models/interfaces/workspace";

import type { MultiPanelStoreHook } from "@/models/types/workspace/useMultiPanelStore";

export interface MultiPanelStoreOptions {
  idPrefix?: string;
  defaultTitle?: string;
}

export interface MultiPanelStore {
  tabs: MultiPanelTab[];
  activeTabId: string;
  closedTabs: MultiPanelTab[];
  closedPanes: MultiPanelClosedPane[];
  activePaneId: string;
  nextPaneIndex: number;
  nextTabIndex: number;
  initialize: (path: string, title?: string) => void;
  addTab: (path: string, title?: string) => string;
  reorderTabs: (tabId: string, fromIndex: number, toIndex: number) => void;
  closeTab: (tabId: string) => void;
  restoreTab: () => void;
  selectTab: (tabId: string) => void;
  updateActiveTabPath: (paneId: string, path: string, title?: string) => void;
  splitPane: (paneId: string, orientation: SplitOrientation) => void;
  closePane: (paneId: string) => void;
  restorePane: () => void;
  collapseDuplicateBrowsePanes: () => void;
  setActivePane: (paneId: string) => void;
  setTabPanelVisibility: (
    tabId: string,
    visibility: { sidebarVisible?: boolean; previewVisible?: boolean },
  ) => void;
  setSplitRatio: (tabId: string, ratioKind: "grid" | "lane0" | "lane1", ratio: number) => void;
  hydrate: (snapshot: {
    tabs: MultiPanelTab[];
    activeTabId: string;
    activePaneId: string;
    closedPanes?: Array<MultiPanelClosedPane | MultiPanelPane>;
    nextPaneIndex: number;
    nextTabIndex: number;
  }) => boolean;
}
