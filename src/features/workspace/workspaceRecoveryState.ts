import { create } from "zustand";
import type { RecoverySaveStatus } from "@/features/browser-sync/recovery";
import type { UnrestoredView } from "./workspaceMigrations";

const noSaves: RecoverySaveStatus = { pending: [], failed: [] };
export const closedRecoveryState = {
  accountId: null,
  ready: false,
  usable: false,
  issue: null,
  saves: noSaves,
  notRestored: [],
};
/** `issue` means this device cannot save at all. Per-item results live in
 * `saves` (waiting in the pending file, or refused) and `notRestored`. */
export const useWorkspaceRecoveryState = create<{
  accountId: string | null;
  ready: boolean;
  usable: boolean;
  issue: string | null;
  saves: RecoverySaveStatus;
  notRestored: UnrestoredView[];
}>(() => ({ ...closedRecoveryState }));
