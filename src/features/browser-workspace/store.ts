import { create } from "zustand";
import type { NativeSyncView } from "./native";

// Deliberately not persisted: native owns shared state and all secret material.
export const useBrowserSyncStore = create<{
  session: NativeSyncView | null;
  issue: string | null;
}>(() => ({ session: null, issue: null }));
