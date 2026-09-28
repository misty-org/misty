import { invoke } from "@tauri-apps/api/core";
import { create } from "zustand";
import { browserRuntimeIdForTabId } from "@/features/webviews/browserRuntime";

interface BrowserMediaStore {
  /** Tabs whose page is audibly playing media. */
  audible: Record<string, boolean>;
  /** Tabs the user muted. */
  muted: Record<string, boolean>;
  setAudible: (tabId: string, audible: boolean) => void;
  toggleMuted: (tabId: string) => Promise<void>;
  removeTab: (tabId: string) => void;
}

export const useBrowserMediaStore = create<BrowserMediaStore>((set, get) => ({
  audible: {},
  muted: {},
  setAudible: (tabId, audible) =>
    set((state) =>
      Boolean(state.audible[tabId]) === audible
        ? state
        : { audible: { ...state.audible, [tabId]: audible } },
    ),
  toggleMuted: async (tabId) => {
    const runtimeId = browserRuntimeIdForTabId(tabId);
    if (!runtimeId) return;
    const muted = !get().muted[tabId];
    await invoke<void>("browser_webview_set_muted", { request: { id: runtimeId, muted } });
    set((state) => ({ muted: { ...state.muted, [tabId]: muted } }));
  },
  removeTab: (tabId) =>
    set((state) => {
      const audible = { ...state.audible };
      const muted = { ...state.muted };
      delete audible[tabId];
      delete muted[tabId];
      return { audible, muted };
    }),
}));
