import { create } from "zustand";
import {
  fileSyncApply,
  fileSyncCompare,
  fileSyncPairRemove,
  fileSyncPairSave,
  fileSyncPairsSnapshot,
} from "@/stores/backend";
import type { FileSyncPlannedAction, FileSyncPolicy } from "@/models/types/services/misty-api";
import type {
  FileSyncApplyResult,
  FileSyncCompareRow,
  FileSyncEndpoint,
  FileSyncPair,
} from "@/models/interfaces/services/misty-api";
import { errorText } from "@/lib/format";

import type {
  FileSyncSession,
  FileSyncStore,
} from "@/models/interfaces/stores/explorer/useFileSyncStore";

export type SetFileSyncState = Parameters<typeof useFileSyncStore.setState>[0] extends infer _Never
  ? (partial: (state: FileSyncStore) => Partial<FileSyncStore>) => void
  : never;
import type { useFileSyncStore } from "@/stores/explorer";
