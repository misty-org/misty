import { create } from "zustand";
import type { NativeSyncView } from "./native";

// Deliberately not persisted: native owns shared state and all secret material.
export const useBrowserSyncStore = create<{
  session: NativeSyncView | null;
  issue: string | null;
  connecting: boolean;
  /** Account whose device the server rejected; its next unlock registers it again. */
  reenroll: string | null;
  /** Explicitly locked accounts must not be reopened by the startup timer. */
  locked: string | null;
}>(() => ({ session: null, issue: null, connecting: false, reenroll: null, locked: null }));
