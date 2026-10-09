import { invoke } from "@tauri-apps/api/core";
import { create } from "zustand";
import {
  browserRuntimeIdForTabId,
  onBrowserRuntimeClose,
} from "@/features/webviews/browserRuntime";

interface BrowserMediaStore {
  /** Tabs whose page is audibly playing media. */
  audible: Record<string, boolean>;
  /** Tabs the user muted. */
  muted: Record<string, boolean>;
  /** Tabs paused from Misty's media controls, so they can be resumed there. */
  paused: Record<string, boolean>;
  setPaused: (tabId: string, paused: boolean) => void;
  setAudible: (tabId: string, audible: boolean) => void;
  toggleMuted: (tabId: string) => Promise<void>;
  /** Records a mute that was already applied to the page, such as by an extension. */
  setMutedState: (tabId: string, muted: boolean) => void;
  removeView: (tabId: string) => void;
}

export const useBrowserMediaStore = create<BrowserMediaStore>((set, get) => ({
  audible: {},
  muted: {},
  paused: {},
  setAudible: (tabId, audible) =>
    set((state) => {
      // Sound again means the page is playing, however it resumed.
      const paused =
        audible && state.paused[tabId]
          ? Object.fromEntries(Object.entries(state.paused).filter(([id]) => id !== tabId))
          : state.paused;
      return Boolean(state.audible[tabId]) === audible && paused === state.paused
        ? state
        : { audible: { ...state.audible, [tabId]: audible }, paused };
    }),
  setPaused: (tabId, paused) =>
    set((state) => {
      const next = { ...state.paused };
      if (paused) next[tabId] = true;
      else delete next[tabId];
      return { paused: next };
    }),
  toggleMuted: async (tabId) => {
    const runtimeId = browserRuntimeIdForTabId(tabId);
    if (!runtimeId) return;
    const muted = !get().muted[tabId];
    await invoke<void>("browser_webview_set_muted", { request: { id: runtimeId, muted } });
    set((state) => ({ muted: { ...state.muted, [tabId]: muted } }));
  },
  setMutedState: (tabId, muted) =>
    set((state) =>
      Boolean(state.muted[tabId]) === muted ? state : { muted: { ...state.muted, [tabId]: muted } },
    ),
  removeView: (tabId) =>
    set((state) => {
      const audible = { ...state.audible };
      const muted = { ...state.muted };
      const paused = { ...state.paused };
      delete audible[tabId];
      delete muted[tabId];
      delete paused[tabId];
      return { audible, muted, paused };
    }),
}));

onBrowserRuntimeClose((tabId) => {
  useBrowserMediaStore.getState().removeView(tabId);
});
