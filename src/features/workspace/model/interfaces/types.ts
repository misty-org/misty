export interface MultiPanelPane {
  id: string;
  title: string;
  path: string;
}

export interface MultiPanelTab {
  namingId?: string;
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
  /** Legacy saved layout shape; Files always restores a single pane. */
  orientation: "vertical" | "horizontal";
  paneIds: string[];
  lanes?: string[][];
  gridSplitRatio?: number;
  laneSplitRatios?: [number, number];
}
