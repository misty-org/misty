export type SplitOrientation = "vertical" | "horizontal";

export interface MultiPanelPane {
  id: string;
  title: string;
  path: string;
}

export interface MultiPanelTab {
  id: string;
  title: string;
  path: string;
  panes: MultiPanelPane[];
  activePaneId: string;
  layout: MultiPanelLayout;
}

export interface MultiPanelLayout {
  orientation: SplitOrientation;
  paneIds: string[];
}
