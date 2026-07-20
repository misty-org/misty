import type { MultiPanelClosedPane, MultiPanelTab } from "@/models/interfaces/workspace";
import type { MultiPanelStore } from "@/models/interfaces/workspace";
import {
  isTransferTableColumn,
  transferDefaultColumnWidths,
  transferMinimumColumnWidths,
  transferTableColumns,
} from "@/pages/Transfers/desktop/transferModel";
import type {
  TransferColumnWidths,
  TransferTableColumn,
} from "@/models/types/pages/Transfers/desktop/transferModel";

export interface TransfersMultiPanelSnapshot {
  tabs: MultiPanelTab[];
  activeTabId: string;
  activePaneId: string;
  closedPanes: MultiPanelClosedPane[];
  nextPaneIndex: number;
  nextTabIndex: number;
}
