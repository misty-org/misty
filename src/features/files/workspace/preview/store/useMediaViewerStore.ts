import type { SearchResult } from "@/native/contracts";
import { create } from "zustand";
export const useMediaViewerStore = create<MediaViewerState>((set) => ({
  result: null,
  open: (result) => set({ result }),
  close: () => set({ result: null }),
}));

export interface MediaViewerState {
  result: SearchResult | null;
  open: (result: SearchResult) => void;
  close: () => void;
}
