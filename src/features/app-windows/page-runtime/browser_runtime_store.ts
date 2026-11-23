import { create } from "zustand";

interface BrowserRuntimeUiState {
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
