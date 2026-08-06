import { create } from "zustand";
import type { SearchResult } from "@/models/interfaces/services/misty-api";
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
