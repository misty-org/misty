import { create } from "zustand";
import { transfersDeleteAll, transfersDeleteSelected, transfersSnapshot } from "@/stores/backend";
import type { TransferStatus, TransferType } from "@/models/types/services/misty-api";
import type { TransferPage } from "@/models/interfaces/services/misty-api";
import { errorText } from "@/lib/format";
import { selectGeneralPreferences, useSettingsStore } from "@/stores/app";

import type {
  TransferLocationScope,
  TransferStatusFilter,
  TransferSortKey,
  TransferSortDirection,
} from "@/models/types/stores/transfers/useTransfersStore";

export interface TransferWorkspaceState {
  search: string;
  selectedIds: Set<number>;
  lastSelectedId: number | null;
  providerFilters: Set<string>;
  typeFilters: Set<TransferType>;
  locationScope: TransferLocationScope;
  statusFilter: TransferStatusFilter;
  sortKey: TransferSortKey;
  sortDirection: TransferSortDirection;
  pageIndex: number;
  focusedTransferId: number | null;
}

export interface TransfersStore {
  transfers: TransferPage | null;
  workspaces: Record<string, TransferWorkspaceState>;
  working: boolean;
  error: string | null;
  message: string | null;
  load: (search?: string, options?: { silent?: boolean; force?: boolean }) => Promise<void>;
  ensureWorkspace: (workspaceId: string) => void;
  setSearch: (workspaceId: string, search: string) => void;
  selectTransfer: (
    workspaceId: string,
    id: number,
    options?: { toggle?: boolean; range?: boolean; visibleTransferIds?: number[] },
  ) => void;
  toggleProviderFilter: (workspaceId: string, provider: string) => void;
  toggleTypeFilter: (workspaceId: string, type: TransferType) => void;
  setLocationScope: (workspaceId: string, scope: TransferLocationScope) => void;
  setStatusFilter: (workspaceId: string, filter: TransferStatusFilter) => void;
  setSort: (workspaceId: string, key: TransferSortKey, direction?: TransferSortDirection) => void;
  setPageIndex: (workspaceId: string, pageIndex: number) => void;
  clearFilters: (workspaceId: string) => void;
  setFocusedTransfer: (workspaceId: string, id: number | null) => void;
  deleteIds: (workspaceId: string, ids: number[]) => Promise<void>;
  deleteSelected: (workspaceId: string) => Promise<void>;
  deleteAll: () => Promise<void>;
}
