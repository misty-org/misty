import { create } from "zustand";

/** Per-page browser state the UI renders. */
interface BrowserRuntimeUiState {
  /** Pages on screen in their host, above or below the renderer, by the key their host gives.
   * Until then the host paints a fill, since the renderer is transparent there and nothing else
   * is. */
  presented: Record<string, boolean>;
  setPresented: (tabId: string, presented: boolean) => void;
}

export const useBrowserRuntimeStore = create<BrowserRuntimeUiState>((set) => ({
  presented: {},
  setPresented: (tabId, presented) =>
    set((state) =>
      Boolean(state.presented[tabId]) === presented
        ? state
        : { presented: { ...state.presented, [tabId]: presented } },
    ),
}));
