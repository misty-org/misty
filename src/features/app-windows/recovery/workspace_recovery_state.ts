import { create } from "zustand";
import type { RecoverySaveStatus } from "./recovery_storage";

const noSaves: RecoverySaveStatus = { pending: [], failed: [] };
export const closedRecoveryState = {
  accountId: null,
  ready: false,
  usable: false,
  issue: null,
  saves: noSaves,
};
export const useWorkspaceRecoveryState = create<{
  accountId: string | null;
  ready: boolean;
  usable: boolean;
  issue: string | null;
  saves: RecoverySaveStatus;
}>(() => ({ ...closedRecoveryState }));
