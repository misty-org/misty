import { invoke } from "@tauri-apps/api/core";
import { create } from "zustand";
import type { BrowserMediaInfo } from "./native";
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
  /** What each page last said it is playing, pushed as it changes. */
  info: Record<string, BrowserMediaInfo>;
  /** Tabs that have played sound: their player stays while they are paused, from anywhere. */
  heard: Record<string, boolean>;
  /** Tabs whose player was closed from its card; it returns when they play sound again. */
  dismissed: Record<string, boolean>;
  dismiss: (tabId: string) => void;
  /** The tab loads another page: what the last one was playing no longer applies. */
  forgetPage: (tabId: string) => void;
  setInfo: (tabId: string, info: BrowserMediaInfo) => void;
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
  info: {},
  heard: {},
  dismissed: {},
  dismiss: (tabId) => set((state) => ({ dismissed: { ...state.dismissed, [tabId]: true } })),
  forgetPage: (tabId) =>
    set((state) => {
      const without = <T>(record: Record<string, T>) =>
        Object.fromEntries(Object.entries(record).filter(([id]) => id !== tabId));
      return {
        info: without(state.info),
        heard: without(state.heard),
        dismissed: without(state.dismissed),
      };
    }),
  setInfo: (tabId, info) =>
    set((state) => {
      const next: Partial<BrowserMediaStore> = { info: { ...state.info, [tabId]: info } };
      // Nothing left to resume: the media ended or the page moved on, so its player can go.
      if (info.hasMedia === false && state.heard[tabId]) {
        const heard = { ...state.heard };
        delete heard[tabId];
        next.heard = heard;
      }
      // Playing again brings back a player that was closed.
      if (!info.paused && state.dismissed[tabId]) {
        const dismissed = { ...state.dismissed };
        delete dismissed[tabId];
        next.dismissed = dismissed;
      }
      return next;
    }),
  setAudible: (tabId, audible) =>
    set((state) => {
      // Sound again means the page is playing, however it resumed.
      const paused =
        audible && state.paused[tabId]
          ? Object.fromEntries(Object.entries(state.paused).filter(([id]) => id !== tabId))
          : state.paused;
      const heard =
        audible && !state.heard[tabId] ? { ...state.heard, [tabId]: true } : state.heard;
      const dismissed =
        audible && state.dismissed[tabId]
          ? Object.fromEntries(Object.entries(state.dismissed).filter(([id]) => id !== tabId))
          : state.dismissed;
      return Boolean(state.audible[tabId]) === audible &&
        paused === state.paused &&
        heard === state.heard &&
        dismissed === state.dismissed
        ? state
        : { audible: { ...state.audible, [tabId]: audible }, paused, heard, dismissed };
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
      const info = { ...state.info };
      delete info[tabId];
      const heard = { ...state.heard };
      delete heard[tabId];
      const dismissed = { ...state.dismissed };
      delete dismissed[tabId];
      return { audible, muted, paused, info, heard, dismissed };
    }),
}));

onBrowserRuntimeClose((tabId) => {
  useBrowserMediaStore.getState().removeView(tabId);
});
