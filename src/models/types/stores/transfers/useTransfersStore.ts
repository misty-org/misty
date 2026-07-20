import { create } from "zustand";
import { transfersDeleteAll, transfersDeleteSelected, transfersSnapshot } from "@/stores/backend";
import type { TransferStatus, TransferType } from "@/models/types/services/misty-api";
import type { TransferPage } from "@/models/interfaces/services/misty-api";
import { errorText } from "@/lib/format";
import { selectGeneralPreferences, useSettingsStore } from "@/stores/app";

import type {
  TransferWorkspaceState,
  TransfersStore,
} from "@/models/interfaces/stores/transfers/useTransfersStore";

export type TransferLocationScope = "all" | "local" | "remote";

export type TransferStatusFilter = "all" | "active" | "completed" | "failed";

export type TransferSortKey = "none" | "time" | "name" | "operation" | "status";

export type TransferSortDirection = "asc" | "desc";
