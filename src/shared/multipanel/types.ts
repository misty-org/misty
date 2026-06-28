export type SplitOrientation = "vertical" | "horizontal";

export interface MultiPanelPane {
  id: string;
  title: string;
  path: string;
}

export type MultiPanelPaneRestoreMode = "same_lane" | "new_lane";

export interface MultiPanelClosedPane {
  pane: MultiPanelPane;
  tabId: string;
  restoreMode: MultiPanelPaneRestoreMode;
  laneIndex: number;
  rowIndex: number;
}

export interface MultiPanelTab {
  id: string;
  title: string;
  path: string;
  panes: MultiPanelPane[];
  activePaneId: string;
  layout: MultiPanelLayout;
  mode?: "browse";
  sidebarVisible?: boolean;
  previewVisible?: boolean;
}

export interface MultiPanelLayout {
  orientation: SplitOrientation;
  paneIds: string[];
  lanes?: string[][];
  gridSplitRatio?: number;
  laneSplitRatios?: [number, number];
}
