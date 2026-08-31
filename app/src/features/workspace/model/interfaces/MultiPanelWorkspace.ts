import type { PointerEvent, ReactNode } from "react";
import type { MultiPanelStoreHook } from "../types/useMultiPanelStore";
import type { ChromeTabStripProps } from "./ChromeTabStrip";
import type { MultiPanelTab } from "./types";

export interface MultiPanelWorkspaceProps {
  className?: string;
  store?: MultiPanelStoreHook;
  renderToolbar?: (paneId: string, path: string) => ReactNode;
  renderBottomBar?: (tab: MultiPanelTab) => ReactNode;
  renderAddTabControl?: (
    activeTab: MultiPanelTab,
    addTab: (path: string, title?: string) => string,
  ) => ReactNode;
  renderTabActions?: () => ReactNode;
  registerTabDropTarget?: ChromeTabStripProps["registerTabDropTarget"];
  showTabStrip?: boolean;
  showDefaultPaneControls?: boolean;
  renderContextHeader?: (tab: MultiPanelTab) => ReactNode;
  renderNavigationAside?: ReactNode;
  navigationAsideWidth?: number;
  onNavigationAsideResizeStart?: (event: PointerEvent<HTMLDivElement>) => void;
  onNavigationAsideResizeBy?: (delta: number) => void;
  navigationAsideResizing?: boolean;
  renderAside?: ReactNode;
  asideWidth?: number;
  onAsideResizeStart?: (event: PointerEvent<HTMLDivElement>) => void;
  onAsideResizeBy?: (delta: number) => void;
  asideResizing?: boolean;
  canCloseTab?: (tab: MultiPanelTab) => boolean;
  onDidCloseTab?: (tab: MultiPanelTab) => void;
  canClosePane?: (paneId: string, tab: MultiPanelTab) => boolean;
  onDidClosePane?: (paneId: string, tab: MultiPanelTab) => void;
  renderPane: (paneId: string, path: string) => ReactNode;
}
