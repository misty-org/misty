import type { MediaViewerState } from "@/models/interfaces/stores/media/useMediaViewerStore";
export type { MediaViewerState } from "@/models/interfaces/stores/media/useMediaViewerStore";
import { create } from "zustand";
import type { SearchResult } from "@/models/interfaces/services/misty-api";
export const useMediaViewerStore = create<MediaViewerState>((set) => ({
  result: null,
  open: (result) => set({ result }),
  close: () => set({ result: null }),
}));
