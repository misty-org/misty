import { create } from "zustand";
import type { NativeSyncView } from "./native";

export const browserSyncRetryEvent = "misty:retry-browser-sync";

// Deliberately not persisted: native owns shared state and all secret material.
export const useBrowserSyncStore = create<{
  session: NativeSyncView | null;
  issue: string | null;
  connecting: boolean;
  /** Account whose device the server rejected; its next unlock registers it again. */
  reenroll: string | null;
}>(() => ({ session: null, issue: null, connecting: false, reenroll: null }));
